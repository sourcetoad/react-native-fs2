package com.rnfs2

import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.fs2.*
import com.rnfs2.utils.Fs2Util
import com.rnfs2.utils.StreamError
import com.rnfs2.utils.FsError

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.io.FileOutputStream
import java.util.concurrent.BlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.UUID

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel

open class Fs2StreamImpl() : HybridFs2StreamSpec() {
    private companion object {
        /** Mirrors MAX_STREAM_BUFFER_SIZE in src/_filestream.ts and maxBufferSize in Fs2Stream.swift. */
        const val MAX_BUFFER_SIZE = 16.0 * 1024 * 1024

        /**
         * Mirrors DEFAULT_STREAM_BUFFER_SIZE in src/_filestream.ts, so a handle created
         * without options reads in the same chunks the high-level helpers ask for.
         */
        const val DEFAULT_BUFFER_SIZE = 64 * 1024
    }

    // Stream state data classes
    /** [isPaused] is separate from [isActive], which means "not closed" - as on iOS. */
    private data class ReadStreamState(
        val file: File,
        val options: ReadStreamOptions?,
        @Volatile var isActive: Boolean = false,
        @Volatile var isPaused: Boolean = false,
        @Volatile var position: Long = 0L,
        var job: Job? = null,
        val resumeSignal: Channel<Unit> = Channel(Channel.CONFLATED)
    )

    private data class WriteStreamState(
        val file: File,
        val options: WriteStreamOptions?,
        @Volatile var isActive: Boolean = false,
        @Volatile var position: Long = 0L,
        var job: Job? = null,
        @Volatile var hasError: Boolean = false
    )

    // Stream handle maps
    private val readStreams = ConcurrentHashMap<String, ReadStreamState>()
    private val writeStreams = ConcurrentHashMap<String, WriteStreamStateImpl>()

    // Coroutine scope for stream operations
    private val streamScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Event listener maps (for demonstration, not yet emitting events)
    private val readStreamDataListeners =
        ConcurrentHashMap<String, (ReadStreamDataEvent) -> Promise<Promise<Boolean>>>()
    private val readStreamProgressListeners =
        ConcurrentHashMap<String, (ReadStreamProgressEvent) -> Unit>()
    private val readStreamEndListeners = ConcurrentHashMap<String, (ReadStreamEndEvent) -> Unit>()
    private val readStreamErrorListeners =
        ConcurrentHashMap<String, (ReadStreamErrorEvent) -> Unit>()
    private val writeStreamProgressListeners =
        ConcurrentHashMap<String, (WriteStreamProgressEvent) -> Unit>()
    private val writeStreamFinishListeners =
        ConcurrentHashMap<String, (WriteStreamFinishEvent) -> Unit>()
    private val writeStreamErrorListeners =
        ConcurrentHashMap<String, (WriteStreamErrorEvent) -> Unit>()

    // Write stream: queue for incoming writes
    /**
     * One item in a write stream's queue.
     *
     * [isFlush] is routed through the queue rather than applied from the caller's coroutine so
     * that it is ordered against the writer. Flushing from the caller raced the writer and only
     * ever flushed userspace, so `await flush()` guaranteed nothing.
     */
    private data class WriteRequest(
        val data: ByteArray?,
        val isString: Boolean = false,
        val isEnd: Boolean = false,
        val isFlush: Boolean = false,
        val completion: CompletableDeferred<Unit>? = null
    )

    // Add reference to RNFSManager and context
    private val reactContext = NitroModules.applicationContext
        ?: throw Error("No Context available!")

    /**
     * Emits a read-stream error, or logs it if nobody is listening.
     *
     * Node throws on an unhandled `'error'`. Throwing from this coroutine would take the app
     * down, so it is logged instead - silently dropping it is the one thing that must not
     * happen.
     */
    private fun emitReadError(streamId: String, message: String) {
        val listener = readStreamErrorListeners[streamId]
        if (listener == null) {
            android.util.Log.w(
                "RNFS2",
                "Read stream $streamId failed with no error listener attached: $message"
            )
            return
        }
        listener.invoke(ReadStreamErrorEvent(streamId = streamId, error = message, code = null))
    }

    /**
     * Hands [event] to the JS consumer and waits for it to finish with the chunk.
     *
     * The JS callback is declared as returning `Promise<boolean>`, which Nitro delivers here
     * as a `Promise<Promise<Boolean>>`: the outer one resolves once the callback has run on
     * the JS thread, the inner one once the promise it returned settles. The value is ignored
     * - it is not `void` because Nitro 0.37 resolves a Kotlin `Promise<Unit>` from C++ with a
     * bare `java.lang.Object`, which throws `ClassCastException` inside `JPromise::resolve`
     * while it holds its mutex, wedging the promise for good. Awaiting both is the whole of
     * the read path's back-pressure. Without it the loop reads at disk speed while every chunk
     * piles up as an owning copy in the dispatcher's unbounded queue, so peak memory tracks the
     * file size rather than the buffer size.
     *
     * The wait goes through a [CompletableDeferred] rather than `Promise.await()`, which is
     * built on a plain `suspendCoroutine` and so ignores cancellation - a consumer that never
     * settles would park the loop on an open descriptor for the life of the process.
     */
    private suspend fun deliver(
        listener: (ReadStreamDataEvent) -> Promise<Promise<Boolean>>,
        event: ReadStreamDataEvent
    ) {
        val ack = CompletableDeferred<Unit>()
        listener(event)
            .then { inner ->
                inner
                    .then { ack.complete(Unit) }
                    .catch { error -> ack.completeExceptionally(error) }
            }
            .catch { error -> ack.completeExceptionally(error) }
        ack.await()
    }

    /**
     * Bytes allowed to sit in the write queue at once - `WriteStreamOptions.bufferSize`.
     *
     * This is what makes `writeToStream`'s promise a real back-pressure signal. It used to
     * resolve the moment the chunk was accepted into a no-arg [LinkedBlockingQueue], capacity
     * `Integer.MAX_VALUE`, so a producer faster than the disk grew native memory without limit
     * while every `await` returned immediately.
     */
    private class WriteBudget(private val capacity: Int) {
        private val waiters = ArrayDeque<Pair<Int, CompletableDeferred<Unit>>>()
        private var pending = 0
        private var closed = false

        /**
         * Suspends until [bytes] fit within [capacity], then charges them to the queue.
         * A chunk larger than the whole budget is admitted on its own rather than waiting for
         * room that can never appear.
         */
        suspend fun reserve(bytes: Int) {
            val gate = synchronized(this) {
                val fits = pending == 0 || pending + bytes <= capacity
                if (closed || (waiters.isEmpty() && fits)) {
                    pending += bytes
                    return
                }
                CompletableDeferred<Unit>().also { waiters.addLast(bytes to it) }
            }
            gate.await()
        }

        /** Returns [bytes] to the budget and admits whoever now fits, in arrival order. */
        fun release(bytes: Int) {
            val admitted = synchronized(this) {
                pending -= bytes
                val ready = mutableListOf<CompletableDeferred<Unit>>()
                while (waiters.isNotEmpty()) {
                    val (needed, gate) = waiters.first()
                    if (pending != 0 && pending + needed > capacity) break
                    waiters.removeFirst()
                    pending += needed
                    ready += gate
                }
                ready
            }
            admitted.forEach { it.complete(Unit) }
        }

        /**
         * Admits everyone still waiting. Nothing will drain the queue after this, so a waiter
         * left parked would be a `write()` that never settles; each one then fails the
         * inactive-stream check instead.
         */
        fun close() {
            val waiting = synchronized(this) {
                closed = true
                val all = waiters.toList()
                waiters.clear()
                all.forEach { pending += it.first }
                all
            }
            waiting.forEach { it.second.complete(Unit) }
        }
    }

    // Helper to open InputStream for reading (file or content URI)
    private fun openInputStream(path: String, start: Long = 0L): InputStream {
        val uri = Fs2Util.getFileUri(path)
        try {
            if ("content" == uri.scheme) {
                val input = reactContext.contentResolver.openInputStream(uri)
                    ?: throw StreamError.NotFound(path)
                if (start > 0) input.skip(start)
                return input
            } else {
                val filePath = Fs2Util.getOriginalFilepath(reactContext, path)
                val file = File(filePath)
                if (!file.canRead()) throw StreamError.AccessDenied(path)
                val raf = RandomAccessFile(filePath, "r")
                raf.seek(start)
                return object : InputStream() {
                    override fun read(): Int = raf.read()
                    override fun read(b: ByteArray, off: Int, len: Int): Int = raf.read(b, off, len)
                    override fun close() = raf.close()
                }
            }
        } catch (e: SecurityException) {
            throw StreamError.AccessDenied(path)
        } catch (e: IOException) {
            throw StreamError.IOError(e.message ?: "I/O error")
        }
    }

    // Helper to open OutputStream for writing (file or content URI)
    private fun openOutputStream(path: String, append: Boolean): OutputStream {
        val uri = Fs2Util.getFileUri(path)
        try {
            if ("content" == uri.scheme) {
                val output = reactContext.contentResolver.openOutputStream(uri, if (append) "wa" else "w")
                    ?: throw StreamError.NotFound(path)
                return output
            } else {
                val filePath = Fs2Util.getOriginalFilepath(reactContext, path)
                val file = File(filePath)

                if (file.exists()) {
                    if (!file.canWrite()) throw StreamError.AccessDenied(path)
                } else {
                    val parentDir = file.parentFile
                    if (parentDir != null && !parentDir.canWrite()) {
                        throw StreamError.AccessDenied(path)
                    }
                }

                return FileOutputStream(filePath, append)
            }
        } catch (e: SecurityException) {
            throw StreamError.AccessDenied(path)
        } catch (e: IOException) {
            throw StreamError.IOError(e.message ?: "I/O error")
        }
    }

    override fun createReadStream(
        path: String,
        options: ReadStreamOptions?
    ): Promise<ReadStreamHandle> {
        return Promise.async {
            val file = File(path)
            if (!file.exists() || !file.isFile) {
                throw StreamError.NotFound(path)
            }
            val streamId = UUID.randomUUID().toString()
            val state = ReadStreamState(file, options)
            readStreams[streamId] = state
            return@async ReadStreamHandle(streamId)
        }
    }

    override fun createWriteStream(
        path: String,
        options: WriteStreamOptions?
    ): Promise<WriteStreamHandle> {
        return Promise.async {
            val file = File(path)
            if (options?.createDirectories == true) {
                file.parentFile?.mkdirs()
            }
            val requestedCapacity: Double =
                options?.bufferSize ?: DEFAULT_BUFFER_SIZE.toDouble()
            if (!requestedCapacity.isFinite() || requestedCapacity < 1.0 ||
                requestedCapacity > MAX_BUFFER_SIZE
            ) {
                throw StreamError.InvalidArgument(
                    "bufferSize must be between 1 and ${MAX_BUFFER_SIZE.toLong()}, " +
                        "got $requestedCapacity"
                )
            }
            val streamId = UUID.randomUUID().toString()
            val outputStream = openOutputStream(path, options?.append == true)
            val queue = LinkedBlockingQueue<WriteRequest>()
            val state = WriteStreamState(file, options, isActive = true)
            val impl = WriteStreamStateImpl(
                state, outputStream, queue, WriteBudget(requestedCapacity.toInt())
            )
            writeStreams[streamId] = impl
            impl.state.job = streamScope.launch {
                var bytesWritten = 0L
                try {
                    writeLoop@ while (true) {
                        val req = impl.queue.take()
                        if (req.isEnd) break@writeLoop
                        if (req.isFlush) {
                            try {
                                impl.outputStream.flush()
                                // Userspace flush alone leaves the bytes in the page cache.
                                (impl.outputStream as? FileOutputStream)?.fd?.sync()
                                req.completion?.complete(Unit)
                            } catch (e: Throwable) {
                                req.completion?.completeExceptionally(e)
                            }
                            continue@writeLoop
                        }
                        req.data?.let { data ->
                            try {
                                impl.outputStream.write(data)
                                impl.state.position += data.size
                                bytesWritten += data.size
                                writeStreamProgressListeners[streamId]?.invoke(
                                    WriteStreamProgressEvent(
                                        streamId = streamId,
                                        bytesWritten = bytesWritten,
                                        lastChunkSize = data.size.toLong()
                                    )
                                )
                            } finally {
                                impl.budget.release(data.size)
                            }
                        }
                    }
                } catch (e: SecurityException) {
                    impl.state.hasError = true
                    writeStreamErrorListeners[streamId]?.invoke(
                        WriteStreamErrorEvent(
                            streamId = streamId,
                            error = StreamError.AccessDenied(state.file.path).message ?: "Access denied",
                            code = null
                        )
                    )
                } catch (e: IOException) {
                    impl.state.hasError = true
                    writeStreamErrorListeners[streamId]?.invoke(
                        WriteStreamErrorEvent(
                            streamId = streamId,
                            error = StreamError.IOError(e.message ?: "I/O error").message ?: "I/O error",
                            code = null
                        )
                    )
                } catch (e: Exception) {
                    impl.state.hasError = true
                    val error = when (e) {
                        is StreamError -> e
                        else -> StreamError.IOError(e.message ?: "Unknown error")
                    }
                    writeStreamErrorListeners[streamId]?.invoke(
                        WriteStreamErrorEvent(
                            streamId = streamId,
                            error = error.message ?: "Unknown error",
                            code = null
                        )
                    )
                } finally {
                    try {
                        impl.outputStream.close()
                    } catch (_: Exception) {
                    }
                    impl.state.isActive = false
                    // Nothing will drain the queue from here on, so release anyone waiting on
                    // it: a queued flush would otherwise never settle.
                    impl.budget.close()
                    while (true) {
                        val pending = impl.queue.poll() ?: break
                        pending.completion?.completeExceptionally(
                            StreamError.StreamInactive(streamId)
                        )
                    }
                }
            }
            return@async WriteStreamHandle(streamId)
        }
    }

    // --- Read Stream Control ---
    override fun startReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw StreamError.InvalidStream(streamId)
            // Atomic claim: two concurrent start() calls must not both launch a read loop.
            synchronized(state) {
                if (state.isActive) return@async
                state.isActive = true
                state.isPaused = false
            }

            // Only create new job if none exists or previous one is completed
            if (state.job == null || state.job?.isActive == false) {
                state.job = streamScope.launch {
                    val requestedBufferSize: Double =
                        state.options?.bufferSize ?: DEFAULT_BUFFER_SIZE.toDouble()
                    val start = state.options?.start ?: 0L
                    val end = state.options?.end
                    // A huge value raises OutOfMemoryError, which the catch ladder below
                    // cannot catch; 0 spins the loop forever.
                    if (!requestedBufferSize.isFinite() || requestedBufferSize < 1.0 ||
                        requestedBufferSize > MAX_BUFFER_SIZE
                    ) {
                        throw StreamError.InvalidArgument(
                            "bufferSize must be between 1 and ${MAX_BUFFER_SIZE.toLong()}, " +
                                "got $requestedBufferSize"
                        )
                    }
                    val bufferSize: Int = requestedBufferSize.toInt()
                    if (start < 0L) {
                        throw StreamError.InvalidArgument("start must be non-negative, got $start")
                    }
                    if (end != null && end < start) {
                        throw StreamError.InvalidArgument(
                            "end ($end) must not be before start ($start)"
                        )
                    }
                    var position = start
                    var chunk = 0L
                    val fileLength = state.file.length()
                    // Progress is reported against the range actually being read. Using the
                    // whole file meant a stream with `start` set could never reach 1.0.
                    val lastByte = minOf(end ?: (fileLength - 1), fileLength - 1)
                    val rangeTotal = maxOf(0L, lastByte - start + 1)
                    var bytesReadTotal = 0L
                    try {
                        state.position = position
                        openInputStream(state.file.path, start).use { inputStream ->
                            // One buffer for the whole stream, sized exactly. The pool this
                            // replaced bucketed at 8 KB, so a default-configured stream missed
                            // it on `acquire` and was rejected on `release`, and it handed back
                            // recycled buffers without scrubbing them.
                            val buffer = ByteArray(bufferSize)
                            readLoop@ while (state.isActive) {
                                ensureActive() // a suspension point, so close() is observed

                                // CONFLATED: a resume arriving before we park is retained.
                                while (state.isPaused && state.isActive) {
                                    state.resumeSignal.receive()
                                }
                                if (!state.isActive) break@readLoop

                                // Perform I/O without holding the lock
                                val bytesToRead = if (end != null) {
                                    val remaining = end - position + 1
                                    if (remaining <= 0) break@readLoop
                                    minOf(bufferSize.toLong(), remaining).toInt()
                                } else bufferSize.toInt()

                                val read = inputStream.read(buffer, 0, bytesToRead)
                                // `<= 0`, not `== -1`: read() may legally return 0.
                                if (read <= 0) break@readLoop

                                val data = buffer.copyOf(read)

                                val listener = readStreamDataListeners[streamId]
                                if (listener != null) {
                                    deliver(
                                        listener,
                                        ReadStreamDataEvent(
                                            streamId = streamId,
                                            data = ArrayBuffer.copy(java.nio.ByteBuffer.wrap(data)),
                                            chunk = chunk,
                                            position = position
                                        )
                                    )
                                }

                                position += read
                                state.position = position
                                bytesReadTotal += read
                                chunk++

                                readStreamProgressListeners[streamId]?.invoke(
                                    ReadStreamProgressEvent(
                                        streamId = streamId,
                                        bytesRead = bytesReadTotal,
                                        totalBytes = rangeTotal,
                                        progress = if (rangeTotal > 0)
                                            bytesReadTotal.toDouble() / rangeTotal.toDouble()
                                        else 0.0
                                    )
                                )

                                if (end != null && position > end) break@readLoop
                            }
                        }
                        readStreamEndListeners[streamId]?.invoke(
                            ReadStreamEndEvent(
                                streamId = streamId,
                                bytesRead = bytesReadTotal,
                                success = true
                            )
                        )
                    } catch (e: CancellationException) {
                        // close() cancels the job; closeReadStream emits the end event itself,
                        // so an error event here would be a lie about why the read stopped.
                        throw e
                    } catch (e: SecurityException) {
                        val error = StreamError.AccessDenied(state.file.path)
                        emitReadError(streamId, error.message ?: "Access denied")
                    } catch (e: IOException) {
                        val error = StreamError.IOError(e.message ?: "I/O error")
                        emitReadError(streamId, error.message ?: "I/O error")
                    } catch (e: Exception) {
                        val error = when (e) {
                            is StreamError -> e
                            else -> StreamError.IOError(e.message ?: "Unknown error")
                        }
                        emitReadError(streamId, error.message ?: "Unknown error")
                    } finally {
                        state.isActive = false
                        state.job = null
                        // closeReadStream removes the stream first and emits the end event
                        // after joining; clearing the listeners here would drop it.
                        if (readStreams.remove(streamId) != null) {
                            readStreamDataListeners.remove(streamId)
                            readStreamProgressListeners.remove(streamId)
                            readStreamEndListeners.remove(streamId)
                            readStreamErrorListeners.remove(streamId)
                        }
                    }
                }
            }
        }
    }

    override fun pauseReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw FsError("ENOENT: No such read stream: $streamId")
            if (!state.isActive) return@async

            state.isPaused = true
        }
    }

    override fun resumeReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw FsError("ENOENT: No such read stream: $streamId")
            if (!state.isActive) return@async

            state.isPaused = false
            state.resumeSignal.trySend(Unit)
        }
    }

    override fun closeReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state = readStreams.remove(streamId)
                ?: throw FsError("ENOENT: No such read stream: $streamId")
            // Clear the flag, unpark the reader, then wait for it to actually stop.
            state.isActive = false
            state.isPaused = false
            state.resumeSignal.trySend(Unit)
            state.job?.cancel()
            state.job?.join()
            // iOS emits an end event here too; `success = false` is what tells a caller the
            // bytes it received are partial rather than the whole file.
            readStreamEndListeners[streamId]?.invoke(
                ReadStreamEndEvent(
                    streamId = streamId,
                    bytesRead = state.position,
                    success = false
                )
            )
            readStreamDataListeners.remove(streamId)
            readStreamProgressListeners.remove(streamId)
            readStreamEndListeners.remove(streamId)
            readStreamErrorListeners.remove(streamId)
        }
    }

    override fun isReadStreamActive(streamId: String): Promise<Boolean> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw FsError("ENOENT: No such read stream: $streamId")
            return@async state.isActive
        }
    }

    // --- Write Stream Control ---
    override fun writeToStream(streamId: String, data: ArrayBuffer): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            copiedBuffer = data.asOwning()
        } catch (e: Exception) {
            return Promise.rejected(StreamError.BufferError("Failed to copy ArrayBuffer: ${e.message}"))
        }

        return Promise.async {
            val impl = writeStreams[streamId] ?: throw StreamError.InvalidStream(streamId)
            if (!impl.state.isActive) throw StreamError.StreamInactive(streamId)
            val bytes = copiedBuffer.getBuffer(true).let { buf ->
                if (buf.hasArray()) {
                    buf.array().copyOfRange(
                        buf.arrayOffset() + buf.position(),
                        buf.arrayOffset() + buf.limit()
                    )
                } else {
                    ByteArray(buf.remaining()).also { buf.get(it) }
                }
            }
            // Suspends while the queue is full: this promise resolving is the caller's signal
            // that there is room, which is what `bufferSize` now bounds.
            impl.budget.reserve(bytes.size)
            if (!impl.state.isActive) {
                impl.budget.release(bytes.size)
                throw StreamError.StreamInactive(streamId)
            }
            impl.queue.add(WriteRequest(bytes))
            impl.state.job?.let { if (!it.isActive) throw StreamError.StreamInactive(streamId) }
        }
    }

    override fun flushWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw FsError("ENOENT: No such write stream: $streamId")
            if (!impl.state.isActive) throw StreamError.StreamInactive(streamId)

            val done = CompletableDeferred<Unit>()
            impl.queue.add(WriteRequest(null, isFlush = true, completion = done))
            done.await()
        }
    }

    override fun closeWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl = writeStreams.remove(streamId) ?: throw StreamError.InvalidStream(streamId)

            // Signal end to prevent new writes and wait for pending writes to complete
            impl.state.isActive = false
            impl.queue.add(WriteRequest(null, isEnd = true))

            // Wait for background job to finish processing
            impl.state.job?.join()

            try {
                impl.outputStream.close()
            } catch (_: Exception) {
            }

            writeStreamFinishListeners[streamId]?.invoke(
                WriteStreamFinishEvent(
                    streamId = streamId,
                    bytesWritten = impl.state.position,
                    success = !impl.state.hasError
                )
            )

            writeStreamProgressListeners.remove(streamId)
            writeStreamFinishListeners.remove(streamId)
            writeStreamErrorListeners.remove(streamId)
        }
    }

    override fun isWriteStreamActive(streamId: String): Promise<Boolean> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw FsError("ENOENT: No such write stream: $streamId")
            return@async impl.state.isActive
        }
    }

    override fun getWriteStreamPosition(streamId: String): Promise<Long> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw FsError("ENOENT: No such write stream: $streamId")
            return@async impl.state.position
        }
    }

    override fun endWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw FsError("ENOENT: No such write stream: $streamId")

            // Mark the stream as finished (no more writes)
            impl.state.isActive = false

            // Enqueue an 'end' marker to unblock the write job
            impl.queue.add(WriteRequest(null, isEnd = true))

            // Wait for the background job to finish
            impl.state.job?.join()

            // Now cleanup (remove from map, close file, emit finish)
            writeStreams.remove(streamId)

            try {
                impl.outputStream.flush()
            } catch (_: Exception) {
            }
            try {
                impl.outputStream.close()
            } catch (_: Exception) {
            }

            writeStreamFinishListeners[streamId]?.invoke(
                WriteStreamFinishEvent(
                    streamId = streamId,
                    bytesWritten = impl.state.position,
                    success = !impl.state.hasError
                )
            )

            writeStreamProgressListeners.remove(streamId)
            writeStreamFinishListeners.remove(streamId)
            writeStreamErrorListeners.remove(streamId)
        }
    }

    // --- Event Listener Registration ---
    override fun listenToReadStreamData(
        streamId: String,
        onData: (event: ReadStreamDataEvent) -> Promise<Promise<Boolean>>
    ): () -> Unit {
        readStreamDataListeners[streamId] = onData
        return { readStreamDataListeners.remove(streamId) }
    }

    override fun listenToReadStreamProgress(
        streamId: String,
        onProgress: (event: ReadStreamProgressEvent) -> Unit
    ): () -> Unit {
        readStreamProgressListeners[streamId] = onProgress
        return { readStreamProgressListeners.remove(streamId) }
    }

    override fun listenToReadStreamEnd(
        streamId: String,
        onEnd: (event: ReadStreamEndEvent) -> Unit
    ): () -> Unit {
        readStreamEndListeners[streamId] = onEnd
        return { readStreamEndListeners.remove(streamId) }
    }

    override fun listenToReadStreamError(
        streamId: String,
        onError: (event: ReadStreamErrorEvent) -> Unit
    ): () -> Unit {
        readStreamErrorListeners[streamId] = onError
        return { readStreamErrorListeners.remove(streamId) }
    }

    override fun listenToWriteStreamProgress(
        streamId: String,
        onProgress: (event: WriteStreamProgressEvent) -> Unit
    ): () -> Unit {
        writeStreamProgressListeners[streamId] = onProgress
        return { writeStreamProgressListeners.remove(streamId) }
    }

    override fun listenToWriteStreamFinish(
        streamId: String,
        onFinish: (event: WriteStreamFinishEvent) -> Unit
    ): () -> Unit {
        writeStreamFinishListeners[streamId] = onFinish
        return { writeStreamFinishListeners.remove(streamId) }
    }

    override fun listenToWriteStreamError(
        streamId: String,
        onError: (event: WriteStreamErrorEvent) -> Unit
    ): () -> Unit {
        writeStreamErrorListeners[streamId] = onError
        return { writeStreamErrorListeners.remove(streamId) }
    }

    // WriteStreamStateImpl: extends WriteStreamState with queue and outputStream
    private class WriteStreamStateImpl(
        val state: WriteStreamState,
        val outputStream: OutputStream,
        val queue: BlockingQueue<WriteRequest>,
        val budget: WriteBudget
    )
}
