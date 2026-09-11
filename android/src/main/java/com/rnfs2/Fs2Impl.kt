package com.rnfs2

import com.facebook.react.bridge.ReadableMap
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.fs2.*
import com.rnfs2.utils.FsError
import com.rnfs2.utils.JsVisibleError
import java.io.File
import java.io.FileNotFoundException
import java.net.URL
import java.nio.ByteBuffer

open class Fs2Impl() : HybridFs2Spec() {
    private val reactContext = NitroModules.applicationContext
        ?: throw Error("No Context available!")
    private val rnfsManager = RNFSManager(reactContext)
    private val listeners = DownloadListeners()

    data class DownloadListeners(
        val beginListeners: MutableMap<Double, ((DownloadEventResult) -> Unit)?> = mutableMapOf(),
        val progressListeners: MutableMap<Double, ((DownloadEventResult) -> Unit)?> = mutableMapOf(),
        val completeListeners: MutableMap<Double, ((DownloadEventResult) -> Unit)?> = mutableMapOf(),
        val errorListeners: MutableMap<Double, ((DownloadEventResult) -> Unit)?> = mutableMapOf()
    )

    // Companion object to manage job IDs and active downloaders
    companion object {
        private val activeDownloaders = mutableMapOf<Int, Downloader>()

        // Method to be called by Downloader when it finishes
        fun downloaderDidFinish(jobId: Int) {
            activeDownloaders.remove(jobId)
        }
    }

    // Cache the directory paths at initialization
    override val cachesDirectoryPath: String = RNFSManager.getCachesDirectoryPath(reactContext)
    override val externalCachesDirectoryPath: String =
        RNFSManager.getExternalCachesDirectoryPath(reactContext) ?: ""
    override val documentDirectoryPath: String =
        RNFSManager.getDocumentDirectoryPath(reactContext) ?: ""
    override val downloadDirectoryPath: String = RNFSManager.getDownloadDirectoryPath()
    override val externalDirectoryPath: String =
        RNFSManager.getExternalDirectoryPath(reactContext) ?: ""
    override val externalStorageDirectoryPath: String =
        RNFSManager.getExternalStorageDirectoryPath() ?: ""
    override val temporaryDirectoryPath: String =
        RNFSManager.getTemporaryDirectoryPath(reactContext)
    override val libraryDirectoryPath: String = "" // Not available on Android
    override val mainBundlePath: String = "" // Not available on Android
    override val picturesDirectoryPath: String = RNFSManager.getPicturesDirectoryPath()

    override fun mkdir(filepath: String, options: MkdirOptions?): Promise<Unit> {
        return Promise.async {
            try {
                rnfsManager.mkdir(filepath, options)
                return@async
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    // `options` is iOS-only file protection; Android has no equivalent, so it is accepted
    // and ignored rather than rejected - the same shape `mkdir` already has.
    override fun moveFile(filepath: String, destPath: String, options: FileOptions?): Promise<Unit> {
        return Promise.async {
            try {
                rnfsManager.moveFile(filepath, destPath)
                return@async
            } catch (e: Exception) {
                // Adjust error message to be more specific to moveFile if needed
                throw reject(filepath, e)
            }
        }
    }

    // `options` is iOS-only file protection; Android has no equivalent, so it is accepted
    // and ignored rather than rejected - the same shape `mkdir` already has.
    override fun copyFile(filepath: String, destPath: String, options: FileOptions?): Promise<Unit> {
        return Promise.async {
            try {
                // Directly call RNFSManager.copyFile.
                // RNFSManager.copyFile (via its helpers getInputStream/getOutputStream)
                // will handle:
                // - Source existence check (throws ENOENT if not found after path/URI resolution)
                // - Source is directory check (throws EISDIR if source is a directory)
                // - Content URI resolution for both source and destination paths internally
                // - Parent directory creation for destination (if destination is a direct file
                // path)
                // - Overwriting destination if it's an existing file
                // - Failing if destination is an existing directory (as getOutputStream would fail)
                rnfsManager.copyFile(filepath, destPath)
                return@async
            } catch (e: Exception) {
                // The reject helper in Fs2.kt will catch IORejectionException from RNFSManager
                // (e.g., code "ENOENT" or "EISDIR") and rethrow them appropriately.
                throw reject(filepath, e)
            }
        }
    }

    override fun unlink(filepath: String): Promise<Unit> {
        return Promise.async {
            try {
                rnfsManager.unlink(filepath)
                return@async
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun exists(filepath: String): Promise<Boolean> {
        return Promise.async {
            try {
                return@async rnfsManager.exists(filepath)
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun readDir(dirPath: String): Promise<Array<ReadDirItem>> {
        return Promise.async {
            try {
                val fileStats = rnfsManager.readDir(dirPath)
                val readDirItems =
                    fileStats
                        .map { stat ->
                            ReadDirItem(
                                name = stat.name,
                                path = stat.path,
                                size = stat.size.toDouble(),
                                isFile = (stat.type == RNFSManager.FILE_TYPE_REGULAR),
                                isDirectory =
                                    (stat.type == RNFSManager.FILE_TYPE_DIRECTORY),
                                mtime = stat.lastModified.toDouble(),
                                ctime = null
                            )
                        }
                        .toTypedArray()
                return@async readDirItems
            } catch (e: Exception) {
                throw reject(dirPath, e)
            }
        }
    }

    override fun readFile(path: String): Promise<ArrayBuffer> {
        return Promise.async {
            try {
                val fileBytes = rnfsManager.readFile(path)
                val byteBuffer = ByteBuffer.wrap(fileBytes)

                return@async ArrayBuffer.copy((byteBuffer))
            } catch (e: Exception) {
                throw reject(path, e)
            }
        }
    }

    override fun read(filepath: String, length: Double, position: Double): Promise<ArrayBuffer> {
        return Promise.async {
            try {
                if (!position.isFinite() || position < 0) {
                    throw FsError(
                        "EINVAL: position must be a non-negative finite number, got $position"
                    )
                }
                if (!length.isFinite() || length < 0) {
                    throw FsError(
                        "EINVAL: length must be a non-negative finite number, got $length"
                    )
                }

                val lengthInt = length.toInt()
                val positionInt = position.toInt()

                // Read bytes directly, no base64 involved
                val byteArray = rnfsManager.read(filepath, lengthInt, positionInt)

                // Create and return ArrayBuffer from byte array
                val byteBuffer = ByteBuffer.wrap(byteArray)
                return@async ArrayBuffer.copy((byteBuffer))
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    // `options` is iOS-only file protection; Android has no equivalent, so it is accepted
    // and ignored rather than rejected - the same shape `mkdir` already has.
    override fun writeFile(path: String, data: ArrayBuffer, options: FileOptions?): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            // Create a copy of the ArrayBuffer to ensure we have ownership
            copiedBuffer = data.asOwning()
        } catch (e: Exception) {
            // If copying fails, reject immediately
            return Promise.rejected(fsError(path, e))
        }

        return Promise.async {
            try {
                val byteBuffer = copiedBuffer.getBuffer(copyIfNeeded = true)
                val byteArray: ByteArray
                if (byteBuffer.hasArray()) {
                    byteArray =
                        byteBuffer
                            .array()
                            .copyOfRange(
                                byteBuffer.arrayOffset() + byteBuffer.position(),
                                byteBuffer.arrayOffset() + byteBuffer.limit()
                            )
                } else {
                    byteArray = ByteArray(byteBuffer.remaining())
                    byteBuffer.get(byteArray)
                }

                rnfsManager.writeFile(path, byteArray)
                return@async
            } catch (e: Exception) {
                throw reject(path, e)
            }
        }
    }

    override fun appendFile(filepath: String, data: ArrayBuffer): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            // Create a copy of the ArrayBuffer to ensure we have ownership
            copiedBuffer = data.asOwning()
        } catch (e: Exception) {
            // If copying fails, reject immediately
            return Promise.rejected(fsError(filepath, e))
        }

        return Promise.async {
            try {
                val byteBuffer = copiedBuffer.getBuffer(copyIfNeeded = true)
                val byteArray: ByteArray
                if (byteBuffer.hasArray()) {
                    byteArray =
                        byteBuffer
                            .array()
                            .copyOfRange(
                                byteBuffer.arrayOffset() + byteBuffer.position(),
                                byteBuffer.arrayOffset() + byteBuffer.limit()
                            )
                } else {
                    byteArray = ByteArray(byteBuffer.remaining())
                    byteBuffer.get(byteArray)
                }

                rnfsManager.appendFile(filepath, byteArray)
                return@async
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun write(filepath: String, data: ArrayBuffer, position: Double?): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            // Create a copy of the ArrayBuffer to ensure we have ownership
            copiedBuffer = data.asOwning()
        } catch (e: Exception) {
            // If copying fails, reject immediately
            return Promise.rejected(fsError(filepath, e))
        }

        return Promise.async {
            try {
                val byteBuffer = copiedBuffer.getBuffer(copyIfNeeded = true)
                val byteArray: ByteArray
                if (byteBuffer.hasArray()) {
                    byteArray =
                        byteBuffer
                            .array()
                            .copyOfRange(
                                byteBuffer.arrayOffset() + byteBuffer.position(),
                                byteBuffer.arrayOffset() + byteBuffer.limit()
                            )
                } else {
                    byteArray = ByteArray(byteBuffer.remaining())
                    byteBuffer.get(byteArray)
                }

                // Write directly using the updated method, no base64 involved
                rnfsManager.write(filepath, byteArray, position?.toInt() ?: -1)
                return@async
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun stat(filepath: String): Promise<NativeStatResult> {
        return Promise.async {
            try {
                val fileStat = rnfsManager.stat(filepath)
                return@async fileStat
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun hash(filepath: String, algorithm: HashAlgorithm): Promise<String> {
        return Promise.async {
            try {
                // The HashAlgorithm enum values from TypeScript will be passed as strings
                // (e.g., "md5", "sha256") which is what rnfsManager.hash expects.
                return@async rnfsManager.hash(filepath, algorithm.toString())
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun touch(filepath: String, mtime: Double?, ctime: Double?): Promise<Unit> {
        return Promise.async {
            try {
                // Android only supports setting the modified time (mtime)
                // We'll ignore ctime as it's not applicable on Android
                if (mtime != null) {
                    val result = rnfsManager.touch(filepath, mtime.toLong(), null)
                    if (!result) {
                        // If the operation failed, throw an appropriate error
                        throw FsError(
                            "ETOUCH: Failed to set modification time for file at path: $filepath"
                        )
                    }
                }

                return@async
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun getFSInfo(): Promise<FSInfoResult> {
        return Promise.async {
            try {
                val fsInfo = rnfsManager.getFSInfo()
                // 3.x resolved all four of these on Android (master:RNFSManager.java:549-554)
                // even though FSInfoResult only declared the first two. The external pair stays
                // null when no volume is mounted; iOS never reports them at all.
                return@async FSInfoResult(
                    totalSpace = fsInfo.totalSpace.toDouble(),
                    freeSpace = fsInfo.freeSpace.toDouble(),
                    totalSpaceEx = fsInfo.totalSpaceEx?.toDouble(),
                    freeSpaceEx = fsInfo.freeSpaceEx?.toDouble()
                )
            } catch (e: Exception) {
                // Although rnfsManager.getFSInfo() doesn't declare throwing specific exceptions,
                // we catch broadly here just in case of unexpected runtime issues.
                throw FsError("EFSINFO: Failed to get file system info: ${e.message}")
            }
        }
    }

    override fun downloadFile(
        options: DownloadFileOptions,
        headers: Map<String, String>?
    ): Promise<Double> {
        val downloadPromise: Promise<Double> = Promise()
        // `onCleanup` always fires, including after a failure, so without this guard a failed
        // download resolved successfully - the error reached the `error` listener but the
        // promise still settled with the jobId.
        val settled = java.util.concurrent.atomic.AtomicBoolean(false)

        try {
            val currentJobId = options.jobId
            val params =
                DownloadParams().apply {
                    this.jobId = currentJobId.toInt()
                    this.src = URL(options.fromUrl)
                    this.dest = File(options.toFile)
                    this.headers = convertHeadersToReadableMap(headers)

                    options.connectionTimeout?.let { this.connectionTimeout = it.toInt() }
                    options.readTimeout?.let { this.readTimeout = it.toInt() }
                    options.progressInterval?.let { this.progressInterval = it.toInt() }
                    options.progressDivider?.let { this.progressDivider = it.toFloat() }

                    // Assign callbacks directly from parameters
                    this.onDownloadBegin = { event ->
                        listeners.beginListeners[event.jobId]?.invoke(event)
                    }
                    this.onDownloadProgress = { event ->
                        listeners.progressListeners[event.jobId]?.invoke(event)
                    }
                    this.onDownloadComplete = { result ->
                        listeners.completeListeners[result.jobId]?.invoke(result)
                    }
                    this.onDownloadError = { event ->
                        listeners.errorListeners[event.jobId]?.invoke(event)
                        if (settled.compareAndSet(false, true)) {
                            downloadPromise.reject(
                                FsError(
                                    "EDOWNLOAD: ${event.error ?: "download failed"}"
                                )
                            )
                        }
                    }
                    this.onCleanup = { finishedJobId ->
                        downloaderDidFinish(finishedJobId)
                        if (settled.compareAndSet(false, true)) {
                            downloadPromise.resolve(finishedJobId.toDouble())
                        }
                    }
                }

            val downloader = Downloader()
            activeDownloaders[currentJobId.toInt()] = downloader // Store the downloader instance
            downloader.start(params)
        } catch (e: Exception) {
            val currentJobId = options.jobId

            // Handle synchronous errors during setup (e.g., invalid URL)
            // Asynchronous errors during download will be reported via onDownloadError
            // callback.
            listeners.errorListeners[currentJobId]?.invoke(
                DownloadEventResult(
                    jobId = currentJobId,
                    headers = null,
                    contentLength = null,
                    bytesWritten = null,
                    statusCode = null,
                    error = e.message ?: "Error setting up download",
                )
            )

            if (settled.compareAndSet(false, true)) {
                downloadPromise.reject(fsError(options.toFile, e))
            }
        }

        return downloadPromise
    }

    override fun stopDownload(jobId: Double): Promise<Unit> {
        return Promise.async {
            try {
                val downloader = activeDownloaders[jobId.toInt()]
                if (downloader != null) {
                    downloader.stop()
                    activeDownloaders.remove(jobId.toInt()) // Remove as it's now stopped
                } else {
                    // Optionally log or handle if no downloader is found for the jobId
                    // This could mean it already completed/errored or was already stopped.
                    println("Fs2: No active downloader found for jobId: $jobId to stop.")
                }
                return@async
            } catch (e: Exception) {
                // Consider specific error handling for stopDownload if necessary
                throw reject("jobId: $jobId", e) // Use a placeholder path for reject
            }
        }
    }

    /**
     * iOS-only. Android downloads cannot be paused and resumed - once stopped they are
     * cancelled - and 3.x had no Android implementation at all, so this threw a TypeError at
     * the call site. Rejecting ENOTSUP keeps it loud rather than silently doing nothing.
     */
    override fun resumeDownload(jobId: Double): Promise<Unit> {
        return Promise.async {
            throw FsError("ENOTSUP: resumeDownload is not supported on Android")
        }
    }

    /**
     * iOS-only, as [resumeDownload]. Resolving `false` here would be worse than throwing: it is
     * indistinguishable from a real "this download cannot be resumed".
     */
    override fun isResumable(jobId: Double): Promise<Boolean> {
        return Promise.async {
            throw FsError("ENOTSUP: isResumable is not supported on Android")
        }
    }

    override fun listenToDownloadBegin(
        jobId: Double,
        onDownloadBegin: ((event: DownloadEventResult) -> Unit)?
    ): () -> Unit {
        listeners.beginListeners[jobId] = onDownloadBegin
        return { listeners.beginListeners.remove(jobId) }
    }

    override fun listenToDownloadProgress(
        jobId: Double,
        onDownloadProgress: ((event: DownloadEventResult) -> Unit)?
    ): () -> Unit {
        listeners.progressListeners[jobId] = onDownloadProgress
        return { listeners.progressListeners.remove(jobId) }
    }

    override fun listenToDownloadComplete(
        jobId: Double,
        onDownloadComplete: ((result: DownloadEventResult) -> Unit)?
    ): () -> Unit {
        listeners.completeListeners[jobId] = onDownloadComplete
        return { listeners.completeListeners.remove(jobId) }
    }

    override fun listenToDownloadError(
        jobId: Double,
        onDownloadError: ((event: DownloadEventResult) -> Unit)?
    ): () -> Unit {
        listeners.errorListeners[jobId] = onDownloadError
        return { listeners.errorListeners.remove(jobId) }
    }

    // iOS only: No-op on Android
    override fun listenToDownloadCanBeResumed(
        jobId: Double,
        onDownloadCanBeResumed: ((event: DownloadEventResult) -> Unit)?
    ): () -> Unit {
        // No-op, Android does not support download can-be-resumed events
        return {}
    }

    override fun getAllExternalFilesDirs(): Promise<Array<String>> {
        return Promise.async {
            try {
                return@async rnfsManager.getAllExternalFilesDirs()
            } catch (e: Exception) {
                throw reject("getAllExternalFilesDirs", e)
            }
        }
    }

    override fun scanFile(path: String): Promise<Array<String>> {
        val scanPromise: Promise<Array<String>> = Promise()

        try {
            rnfsManager.scanFile(path) { scannedPaths -> scanPromise.resolve(scannedPaths) }
        } catch (e: Exception) {
            // The scan itself is asynchronous; only connection setup can fail synchronously.
            scanPromise.reject(fsError(path, e))
        }

        return scanPromise
    }

    // Private methods

    /**
     * Builds the JS-facing error for [ex] without throwing it.
     *
     * Use this wherever the error has to be handed to something else - `Promise.rejected`,
     * `Promise.reject` - and [reject] wherever it should propagate out of the current frame.
     */
    private fun fsError(filepath: String, ex: Exception): Throwable {
        // Already a JS-facing error carrying a formatted "CODE: message" - propagate it
        // unchanged. Without this it would be re-wrapped as "EUNSPECIFIED: CODE: message".
        if (ex is JsVisibleError) return ex

        if (ex is FileNotFoundException) {
            return FsError("ENOENT: no such file or directory, open '$filepath'")
        }

        if (ex is IORejectionException) {
            return FsError("${ex.code}: ${ex.message}")
        }

        return FsError("EUNSPECIFIED: ${ex.message ?: ex.toString()}")
    }

    /**
     * Throws the JS-facing error for [ex]. Declared [Nothing] because every path throws -
     * typing it `Throwable` made `Promise.rejected(reject(...))` look like a rejected promise
     * when it was really a synchronous throw.
     */
    private fun reject(filepath: String, ex: Exception): Nothing = throw fsError(filepath, ex)

    // Convert Map<String, String> to ReadableMap for React Native bridge
    private fun convertHeadersToReadableMap(headers: Map<String, String>?): ReadableMap? {
        return headers?.let { headerMap ->
            val writableMap = com.facebook.react.bridge.Arguments.createMap()
            for ((key, value) in headerMap) {
                writableMap.putString(key, value)
            }
            writableMap
        }
    }
}
