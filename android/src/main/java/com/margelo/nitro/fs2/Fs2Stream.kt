package com.margelo.nitro.fs2

import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.fs2.utils.Fs2Util
import com.margelo.nitro.fs2.utils.BufferPool
import com.margelo.nitro.fs2.utils.StreamError

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
import kotlinx.coroutines.sync.withLock

class Fs2Stream() : HybridFs2StreamSpec() {
    // Stream state data classes
    private data class ReadStreamState(
        val file: File,
        val options: ReadStreamOptions?,
        var isActive: Boolean = false,
        var position: Long = 0L,
        var job: Job? = null,
        val pauseMutex: kotlinx.coroutines.sync.Mutex = kotlinx.coroutines.sync.Mutex(locked = false) // Unlocked = active, Locked = paused
    )

    private data class WriteStreamState(
        val file: File,
        val options: WriteStreamOptions?,
        var isActive: Boolean = false,
        var position: Long = 0L,
        var job: Job? = null,
        var hasError: Boolean = false
    )

    // Stream handle maps
    private val readStreams = ConcurrentHashMap<String, ReadStreamState>()
    private val writeStreams = ConcurrentHashMap<String, WriteStreamStateImpl>()

    // Coroutine scope for stream operations
    private val streamScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Event listener maps (for demonstration, not yet emitting events)
    private val readStreamDataListeners = ConcurrentHashMap<String, (ReadStreamDataEvent) -> Unit>()
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
    private data class WriteRequest(
        val data: ByteArray?,
        val isString: Boolean = false,
        val isEnd: Boolean = false
    )

    // Add reference to RNFSManager and context
    private val reactContext = NitroModules.applicationContext!!

    // Add buffer pool instance
    private val bufferPool = BufferPool()

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
            val streamId = UUID.randomUUID().toString()
            val outputStream = openOutputStream(path, options?.append == true)
            val queue = LinkedBlockingQueue<WriteRequest>()
            val state = WriteStreamState(file, options, isActive = true)
            val impl = WriteStreamStateImpl(state, outputStream, queue)
            writeStreams[streamId] = impl
            impl.state.job = streamScope.launch {
                var bytesWritten = 0L
                try {
                    writeLoop@ while (true) {
                        val req = impl.queue.take()
                        if (req.isEnd) break@writeLoop
                        req.data?.let { data ->
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
            if (state.isActive) return@async
            state.isActive = true

            // Only create new job if none exists or previous one is completed
            if (state.job == null || state.job?.isActive == false) {
                state.job = streamScope.launch {
                    val bufferSize = state.options?.bufferSize ?: BufferPool.DEFAULT_BUFFER_SIZE
                    val start = state.options?.start ?: 0L
                    val end = state.options?.end
                    var position = start
                    var chunk = 0L
                    val fileLength = state.file.length()
                    var bytesReadTotal = 0L
                    try {
                        state.position = position
                        openInputStream(state.file.path, start).use { inputStream ->
                            var buffer = bufferPool.acquire(bufferSize.toInt())
                            try {
                                readLoop@ while (true) {
                                    // Wait if paused - acquire lock briefly to check, then suspend if needed
                                    state.pauseMutex.withLock {
                                        // Just checking pause state, lock will be released after this block
                                    }

                                    // Perform I/O without holding the lock
                                    val bytesToRead = if (end != null) {
                                        val remaining = end - position + 1
                                        if (remaining <= 0) break@readLoop
                                        minOf(bufferSize.toLong(), remaining).toInt()
                                    } else bufferSize.toInt()

                                    val read = inputStream.read(buffer, 0, bytesToRead)
                                    if (read == -1) break@readLoop

                                    val data = buffer.copyOf(read)

                                    readStreamDataListeners[streamId]?.invoke(
                                        ReadStreamDataEvent(
                                            streamId = streamId,
                                            data = ArrayBuffer.copy(java.nio.ByteBuffer.wrap(data)),
                                            chunk = chunk,
                                            position = position
                                        )
                                    )

                                    position += read
                                    state.position = position
                                    bytesReadTotal += read
                                    chunk++

                                    readStreamProgressListeners[streamId]?.invoke(
                                        ReadStreamProgressEvent(
                                            streamId = streamId,
                                            bytesRead = bytesReadTotal,
                                            totalBytes = fileLength,
                                            progress = bytesReadTotal.toDouble() / fileLength.toDouble()
                                        )
                                    )

                                    if (end != null && position > end) break@readLoop
                                }
                            } finally {
                                bufferPool.release(buffer)
                            }
                        }
                        readStreamEndListeners[streamId]?.invoke(
                            ReadStreamEndEvent(
                                streamId = streamId,
                                bytesRead = bytesReadTotal,
                                success = true
                            )
                        )
                    } catch (e: SecurityException) {
                        val error = StreamError.AccessDenied(state.file.path)
                        readStreamErrorListeners[streamId]?.invoke(
                            ReadStreamErrorEvent(
                                streamId = streamId,
                                error = error.message ?: "Access denied",
                                code = null
                            )
                        )
                    } catch (e: IOException) {
                        val error = StreamError.IOError(e.message ?: "I/O error")
                        readStreamErrorListeners[streamId]?.invoke(
                            ReadStreamErrorEvent(
                                streamId = streamId,
                                error = error.message ?: "I/O error",
                                code = null
                            )
                        )
                    } catch (e: Exception) {
                        val error = when (e) {
                            is StreamError -> e
                            else -> StreamError.IOError(e.message ?: "Unknown error")
                        }
                        readStreamErrorListeners[streamId]?.invoke(
                            ReadStreamErrorEvent(
                                streamId = streamId,
                                error = error.message ?: "Unknown error",
                                code = null
                            )
                        )
                    } finally {
                        state.isActive = false
                        state.job = null
                        readStreams.remove(streamId)
                        readStreamDataListeners.remove(streamId)
                        readStreamProgressListeners.remove(streamId)
                        readStreamEndListeners.remove(streamId)
                        readStreamErrorListeners.remove(streamId)
                    }
                }
            }
        }
    }

    override fun pauseReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            if (!state.isActive) return@async

            // Use tryLock to avoid deadlock - locks mutex to pause stream
            state.pauseMutex.tryLock()
            state.isActive = false
        }
    }

    override fun resumeReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            if (state.isActive) return@async

            // Safely unlock mutex to resume stream - check if locked first
            if (state.pauseMutex.isLocked) {
                try {
                    state.pauseMutex.unlock()
                } catch (e: IllegalStateException) {
                    // Mutex might have been unlocked by another coroutine, ignore
                }
            }
            state.isActive = true
        }
    }

    override fun closeReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state = readStreams.remove(streamId)
                ?: throw Exception("ENOENT: No such read stream: $streamId")
            state.job?.cancel()
            readStreamDataListeners.remove(streamId)
            readStreamProgressListeners.remove(streamId)
            readStreamEndListeners.remove(streamId)
            readStreamErrorListeners.remove(streamId)
        }
    }

    override fun isReadStreamActive(streamId: String): Promise<Boolean> {
        return Promise.async {
            val state =
                readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            return@async state.isActive
        }
    }

    // --- Write Stream Control ---
    override fun writeToStream(streamId: String, data: ArrayBuffer): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            copiedBuffer = ArrayBuffer.copy(data)
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
            impl.queue.add(WriteRequest(bytes))
            impl.state.job?.let { if (!it.isActive) throw StreamError.StreamInactive(streamId) }
        }
    }

    override fun flushWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            impl.outputStream.flush()
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
                writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            return@async impl.state.isActive
        }
    }

    override fun getWriteStreamPosition(streamId: String): Promise<Long> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            return@async impl.state.position
        }
    }

    override fun endWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl =
                writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")

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
        onData: (event: ReadStreamDataEvent) -> Unit
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
        val queue: BlockingQueue<WriteRequest>
    )
}
