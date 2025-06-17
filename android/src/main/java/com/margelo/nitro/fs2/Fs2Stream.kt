package com.margelo.nitro.fs2

import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.fs2.utils.Fs2Util

import java.io.File
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

class Fs2Stream(): HybridFs2StreamSpec() {
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
        var job: Job? = null
    )

    // Stream handle maps
    private val readStreams = ConcurrentHashMap<String, ReadStreamState>()
    private val writeStreams = ConcurrentHashMap<String, WriteStreamStateImpl>()

    // Coroutine scope for stream operations
    private val streamScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Event listener maps (for demonstration, not yet emitting events)
    private val readStreamDataListeners = ConcurrentHashMap<String, (ReadStreamDataEvent) -> Unit>()
    private val readStreamProgressListeners = ConcurrentHashMap<String, (ReadStreamProgressEvent) -> Unit>()
    private val readStreamEndListeners = ConcurrentHashMap<String, (ReadStreamEndEvent) -> Unit>()
    private val readStreamErrorListeners = ConcurrentHashMap<String, (ReadStreamErrorEvent) -> Unit>()
    private val writeStreamProgressListeners = ConcurrentHashMap<String, (WriteStreamProgressEvent) -> Unit>()
    private val writeStreamFinishListeners = ConcurrentHashMap<String, (WriteStreamFinishEvent) -> Unit>()
    private val writeStreamErrorListeners = ConcurrentHashMap<String, (WriteStreamErrorEvent) -> Unit>()

    // Write stream: queue for incoming writes
    private data class WriteRequest(val data: ByteArray, val isString: Boolean = false)

    // Add reference to RNFSManager and context
    private val reactContext = NitroModules.applicationContext!!

    // Helper to open InputStream for reading (file or content URI)
    private fun openInputStream(path: String, start: Long = 0L): InputStream {
        val uri = Fs2Util.getFileUri(path)
        return if ("content" == uri.scheme) {
            val input = reactContext.contentResolver.openInputStream(uri)
                ?: throw Exception("ENOENT: Could not open input stream for $path")
            if (start > 0) input.skip(start)
            input
        } else {
            val raf = RandomAccessFile(Fs2Util.getOriginalFilepath(reactContext, path), "r")
            raf.seek(start)
            object : InputStream() {
                override fun read(): Int = raf.read()
                override fun read(b: ByteArray, off: Int, len: Int): Int = raf.read(b, off, len)
                override fun close() = raf.close()
            }
        }
    }

    // Helper to open OutputStream for writing (file or content URI)
    private fun openOutputStream(path: String, append: Boolean): OutputStream {
        val uri = Fs2Util.getFileUri(path)
        return if ("content" == uri.scheme) {
            reactContext.contentResolver.openOutputStream(uri, if (append) "wa" else "w")
                ?: throw Exception("ENOENT: Could not open output stream for $path")
        } else {
            FileOutputStream(Fs2Util.getOriginalFilepath(reactContext, path), append)
        }
    }

    override fun createReadStream(
        path: String,
        options: ReadStreamOptions?
    ): Promise<ReadStreamHandle> {
        return Promise.async {
            val file = File(path)
            if (!file.exists() || !file.isFile) {
                throw Exception("ENOENT: File does not exist: $path")
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
                    while (impl.state.isActive) {
                        val req = impl.queue.take()
                        impl.outputStream.write(req.data)
                        impl.state.position += req.data.size
                        bytesWritten += req.data.size
                        writeStreamProgressListeners[streamId]?.invoke(
                            WriteStreamProgressEvent(
                                streamId = streamId,
                                bytesWritten = bytesWritten,
                                lastChunkSize = req.data.size.toLong()
                            )
                        )
                    }
                } catch (e: Exception) {
                    writeStreamErrorListeners[streamId]?.invoke(
                        WriteStreamErrorEvent(
                            streamId = streamId,
                            error = e.message ?: "Unknown error",
                            code = null
                        )
                    )
                } finally {
                    try { impl.outputStream.close() } catch (_: Exception) {}
                    impl.state.isActive = false
                }
            }
            return@async WriteStreamHandle(streamId)
        }
    }

    // --- Read Stream Control ---
    override fun startReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state = readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            if (state.isActive) return@async
            state.isActive = true
            if (state.job == null) {
                state.job = streamScope.launch {
                    val bufferSize = state.options?.bufferSize ?: 8192
                    val encoding = state.options?.encoding ?: Encoding.ARRAYBUFFER
                    val start = state.options?.start ?: 0L
                    val end = state.options?.end
                    var position = start
                    var chunk = 0L
                    val fileLength = state.file.length()
                    var bytesReadTotal = 0L
                    try {
                        state.position = position
                        openInputStream(state.file.path, start).use { inputStream ->
                            val buffer = ByteArray(bufferSize.toInt())
                            readLoop@ while (true) {
                                var shouldBreak = false
                                state.pauseMutex.withLock {
                                    val bytesToRead = if (end != null) {
                                        val remaining = end - position + 1
                                        if (remaining <= 0) {
                                            shouldBreak = true
                                            return@withLock
                                        }
                                        minOf(bufferSize.toLong(), remaining).toInt()
                                    } else bufferSize
                                    val read = inputStream.read(buffer, 0, bytesToRead.toInt())
                                    if (read == -1) {
                                        shouldBreak = true
                                        return@withLock
                                    }
                                    val data = buffer.copyOf(read)

                                    readStreamDataListeners[streamId]?.invoke(
                                        ReadStreamDataEvent(
                                            streamId = streamId,
                                            data = ArrayBuffer.copy(java.nio.ByteBuffer.wrap(data)),
                                            chunk = chunk,
                                            position = position,
                                            encoding = encoding
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
                                    if (end != null && position > end) {
                                        shouldBreak = true
                                        return@withLock
                                    }
                                }
                                if (shouldBreak) break@readLoop
                            }
                        }
                        readStreamEndListeners[streamId]?.invoke(
                            ReadStreamEndEvent(
                                streamId = streamId,
                                bytesRead = bytesReadTotal,
                                success = true
                            )
                        )
                    } catch (e: Exception) {
                        readStreamErrorListeners[streamId]?.invoke(
                            ReadStreamErrorEvent(
                                streamId = streamId,
                                error = e.message ?: "Unknown error",
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
            val state = readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            if (!state.isActive) return@async
            if (!state.pauseMutex.isLocked) state.pauseMutex.lock()
            state.isActive = false
        }
    }

    override fun resumeReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state = readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            if (state.isActive) return@async
            if (state.pauseMutex.isLocked) state.pauseMutex.unlock()
            state.isActive = true
        }
    }

    override fun closeReadStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val state = readStreams.remove(streamId) ?: throw Exception("ENOENT: No such read stream: $streamId")
            state.job?.cancel()
            readStreamDataListeners.remove(streamId)
            readStreamProgressListeners.remove(streamId)
            readStreamEndListeners.remove(streamId)
            readStreamErrorListeners.remove(streamId)
        }
    }

    override fun isReadStreamActive(streamId: String): Promise<Boolean> {
        return Promise.async {
            val state = readStreams[streamId] ?: throw Exception("ENOENT: No such read stream: $streamId")
            return@async state.isActive
        }
    }

    // --- Write Stream Control ---
    override fun writeToStream(streamId: String, data: ArrayBuffer): Promise<Unit> {
        return Promise.async {
            val impl = writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            if (!impl.state.isActive) throw Exception("EPIPE: Write stream is not active: $streamId")
            val bytes = data.getBuffer(true).let { buf ->
                if (buf.hasArray()) {
                    buf.array().copyOfRange(buf.arrayOffset() + buf.position(), buf.arrayOffset() + buf.limit())
                } else {
                    ByteArray(buf.remaining()).also { buf.get(it) }
                }
            }
            impl.queue.add(WriteRequest(bytes))
            impl.state.job?.let { if (!it.isActive) throw Exception("EPIPE: Write job is not active") }
        }
    }

    override fun writeStringToStream(streamId: String, data: String): Promise<Unit> {
        return Promise.async {
            val impl = writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            if (!impl.state.isActive) throw Exception("EPIPE: Write stream is not active: $streamId")
            val encoding = impl.state.options?.encoding ?: Encoding.UTF8
            val bytes = when (encoding) {
                Encoding.UTF8 -> data.toByteArray(Charsets.UTF_8)
                Encoding.ASCII -> data.toByteArray(Charsets.US_ASCII)
                Encoding.BASE64 -> android.util.Base64.decode(data, android.util.Base64.DEFAULT)
                else -> data.toByteArray()
            }
            impl.queue.add(WriteRequest(bytes, isString = true))
            impl.state.job?.let { if (!it.isActive) throw Exception("EPIPE: Write job is not active") }
        }
    }

    override fun flushWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl = writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            impl.outputStream.flush()
        }
    }

    override fun closeWriteStream(streamId: String): Promise<Unit> {
        return Promise.async {
            val impl = writeStreams.remove(streamId) ?: throw Exception("ENOENT: No such write stream: $streamId")
            impl.state.job?.cancel()
            impl.outputStream.close()
            writeStreamProgressListeners.remove(streamId)
            writeStreamFinishListeners.remove(streamId)
            writeStreamErrorListeners.remove(streamId)
            writeStreamFinishListeners[streamId]?.invoke(
                WriteStreamFinishEvent(
                    streamId = streamId,
                    bytesWritten = impl.state.position,
                    success = true
                )
            )
        }
    }

    override fun isWriteStreamActive(streamId: String): Promise<Boolean> {
        return Promise.async {
            val impl = writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            return@async impl.state.isActive
        }
    }

    override fun getWriteStreamPosition(streamId: String): Promise<Long> {
        return Promise.async {
            val impl = writeStreams[streamId] ?: throw Exception("ENOENT: No such write stream: $streamId")
            return@async impl.state.position
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
