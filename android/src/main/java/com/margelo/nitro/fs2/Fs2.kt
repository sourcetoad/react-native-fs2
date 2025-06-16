package com.margelo.nitro.fs2

import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.ReadableMap
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.File
import java.io.FileNotFoundException
import java.net.URL
import java.nio.ByteBuffer

@DoNotStrip
class Fs2() : HybridFs2Spec() {
    private val reactContext = NitroModules.applicationContext!!
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

    override fun moveFile(filepath: String, destPath: String): Promise<Unit> {
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

    override fun copyFile(filepath: String, destPath: String): Promise<Unit> {
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

    override fun writeFile(path: String, data: ArrayBuffer): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            // Create a copy of the ArrayBuffer to ensure we have ownership
            copiedBuffer = ArrayBuffer.copy(data)
        } catch (e: Exception) {
            // If copying fails, reject immediately
            return Promise.rejected(reject(path, e))
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
            copiedBuffer = ArrayBuffer.copy(data)
        } catch (e: Exception) {
            // If copying fails, reject immediately
            return Promise.rejected(reject(filepath, e))
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
                reject(filepath, e)
            }
        }
    }

    override fun write(filepath: String, data: ArrayBuffer, position: Double?): Promise<Unit> {
        val copiedBuffer: ArrayBuffer
        try {
            // Create a copy of the ArrayBuffer to ensure we have ownership
            copiedBuffer = ArrayBuffer.copy(data)
        } catch (e: Exception) {
            // If copying fails, reject immediately
            return Promise.rejected(reject(filepath, e))
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
                        throw Error(
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
                // Map internal storage info to FSInfoResult.
                // External storage info (fsInfo.totalSpaceEx, fsInfo.freeSpaceEx) is available
                // if we decide to expand FSInfoResult in Fs2.nitro.ts later.
                return@async FSInfoResult(
                    totalSpace = fsInfo.totalSpace.toDouble(),
                    freeSpace = fsInfo.freeSpace.toDouble()
                )
            } catch (e: Exception) {
                // Although rnfsManager.getFSInfo() doesn't declare throwing specific exceptions,
                // we catch broadly here just in case of unexpected runtime issues.
                throw Error("EFSINFO: Failed to get file system info: ${e.message}")
            }
        }
    }

    override fun downloadFile(
        options: DownloadFileOptions,
        headers: Map<String, String>?
    ): Promise<Double> {
        val downloadPromise:Promise<Double> = Promise()

        try {
            val currentJobId = options.jobId
            val params =
                DownloadParams().apply {
                    this.jobId = currentJobId.toInt()
                    this.src = URL(options.fromUrl)
                    this.dest = File(options.toFile)
                    this.headers = convertHeadersToReadableMap(headers)

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
                    }
                    this.onCleanup = { finishedJobId ->
                        downloaderDidFinish(finishedJobId)
                        downloadPromise.resolve(finishedJobId.toDouble())
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

            downloadPromise.reject(throw reject(options.toFile, e)) // Also rethrow for the promise rejection
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

    override fun resumeDownload(jobId: Double): Promise<Unit> {
        // Android's DownloadManager does not directly support pausing and resuming downloads
        // in the same way iOS does. Once a download is stopped, it's typically cancelled.
        // For now, we'll make this a no-op or reject, as it's marked iOS-only in Fs2.nitro.ts.
        return Promise.async {
            // Option 1: Reject as not supported
            // throw Error("resumeDownload is not supported on Android")

            // Option 2: No-op (as it's iOS only and this maintains consistency with the .nitro.ts
            // comment)
            return@async // Does nothing.
        }
    }

    override fun isResumable(jobId: Double): Promise<Boolean> {
        // As per resumeDownload, this is not directly applicable to Android's DownloadManager.
        return Promise.async {
            return@async false // Or throw an error if preferred.
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
        return Promise.async { throw Error("getAllExternalFilesDirs is not supported") }
    }

    override fun scanFile(path: String): Promise<Array<String>> {
        return Promise.async { throw Error("scanFile is not supported") }
    }

    // Private methods
    private fun reject(filepath: String, ex: Exception): Throwable {
        if (ex is FileNotFoundException) {
            throw Error("ENOENT: no such file or directory, open '$filepath'")
        }

        if (ex is IORejectionException) {
            throw Error("${ex.code}: ${ex.message}")
        }

        throw Error(ex.message)
    }

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
