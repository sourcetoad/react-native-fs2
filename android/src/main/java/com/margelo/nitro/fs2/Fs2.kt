package com.margelo.nitro.fs2

import android.util.Log
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
        val beginListeners: MutableList<((DownloadEventResult) -> Unit)?> = mutableListOf(),
        val progressListeners: MutableList<((DownloadEventResult) -> Unit)?> = mutableListOf(),
        val completeListeners: MutableList<((DownloadEventResult) -> Unit)?> = mutableListOf(),
        val errorListeners: MutableList<((DownloadEventResult) -> Unit)?> = mutableListOf()
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
                reject(filepath, e)
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
                // - Parent directory creation for destination (if destination is a direct file path)
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
                                isDirectory = (stat.type == RNFSManager.FILE_TYPE_DIRECTORY),
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
                return@async ArrayBuffer(byteBuffer)
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
                return@async ArrayBuffer(byteBuffer)
            } catch (e: Exception) {
                throw reject(filepath, e)
            }
        }
    }

    override fun writeFile(path: String, data: ArrayBuffer): Promise<Unit> {
        return Promise.async {
            try {
                val byteBuffer = data.getBuffer(copyIfNeeded = true)
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
                reject(path, e)
            }
        }
    }

    override fun appendFile(filepath: String, data: ArrayBuffer): Promise<Unit> {
        return Promise.async {
            try {
                val byteBuffer = data.getBuffer(copyIfNeeded = true)
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
        return Promise.async {
            try {
                // Get byte array from ArrayBuffer
                val byteBuffer = data.getBuffer(copyIfNeeded = true)
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
                val statResult =
                    NativeStatResult(
                        size = fileStat.size,
                        type =
                            if (fileStat.type == StatResultType.DIRECTORY)
                                StatResultType.DIRECTORY
                            else StatResultType.FILE,
                        mtime = fileStat.mtime,
                        ctime = fileStat.ctime,
                        mode = null,
                        originalFilepath = fileStat.originalFilepath
                    )
                return@async statResult
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
                        throw Error("ETOUCH: Failed to set modification time for file at path: $filepath")
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
        return Promise.async {
            try {
                val currentJobId = options.jobId.toInt()
                val params = DownloadParams().apply {
                    this.jobId = currentJobId
                    this.src = URL(options.fromUrl)
                    this.dest = File(options.toFile)
                    this.headers = headers?.toReadableMap()

                    // Assign callbacks directly from parameters
                    this.onDownloadBegin = { event ->
                        listeners.beginListeners.forEach { it?.invoke(event) }
                    }
                    this.onDownloadProgress = { event ->
                        listeners.progressListeners.forEach { it?.invoke(event) }
                    }
                    this.onDownloadComplete = { result ->
                        listeners.completeListeners.forEach { it?.invoke(result) }
                    }
                    this.onDownloadError = { event ->
                        listeners.errorListeners.forEach { it?.invoke(event) }
                    }
                    this.onCleanup = { finishedJobId -> downloaderDidFinish(finishedJobId) }
                }

                val downloader = Downloader()
                activeDownloaders[currentJobId] = downloader // Store the downloader instance
                downloader.start(params)

                return@async currentJobId.toDouble()
            } catch (e: Exception) {
                // Handle synchronous errors during setup (e.g., invalid URL)
                // Asynchronous errors during download will be reported via onDownloadError callback.
                listeners.errorListeners.forEach {
                    it?.invoke(
                        DownloadEventResult(
                            jobId = -1.0,
                            headers = null,
                            contentLength = null,
                            bytesWritten = null,
                            statusCode = null,
                            error = e.message ?: "Error setting up download",
                        )
                    )
                }
                throw reject(options.toFile, e) // Also rethrow for the promise rejection
            }
        }
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

            // Option 2: No-op (as it's iOS only and this maintains consistency with the .nitro.ts comment)
            return@async // Does nothing.
        }
    }

    override fun isResumable(jobId: Double): Promise<Boolean> {
        // As per resumeDownload, this is not directly applicable to Android's DownloadManager.
        return Promise.async {
            return@async false // Or throw an error if preferred.
        }
    }

    override fun listenToDownloadBegin(onDownloadBegin: ((event: DownloadEventResult) -> Unit)?): () -> Unit {
        listeners.beginListeners.add(onDownloadBegin)
        return { listeners.beginListeners.remove(onDownloadBegin) }
    }

    override fun listenToDownloadProgress(onDownloadProgress: ((event: DownloadEventResult) -> Unit)?): () -> Unit {
        listeners.progressListeners.add(onDownloadProgress)
        return { listeners.progressListeners.remove(onDownloadProgress) }
    }

    override fun listenToDownloadComplete(onDownloadComplete: ((result: DownloadEventResult) -> Unit)?): () -> Unit {
        listeners.completeListeners.add(onDownloadComplete)
        return { listeners.completeListeners.remove(onDownloadComplete) }
    }

    override fun listenToDownloadError(onDownloadError: ((event: DownloadEventResult) -> Unit)?): () -> Unit {
        listeners.errorListeners.add(onDownloadError)
        return { listeners.errorListeners.remove(onDownloadError) }
    }

    override fun getAllExternalFilesDirs(): Promise<Array<String>> {
        TODO("Not yet implemented")
    }

    override fun scanFile(path: String): Promise<Array<String>> {
        TODO("Not yet implemented")
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

    // Extension function to convert Map<String, String> to ReadableMap (simplified)
    // A more robust implementation might be needed depending on actual ReadableMap requirements.
    private fun Map<String, String>.toReadableMap(): ReadableMap {
        val writableMap = com.facebook.react.bridge.Arguments.createMap()
        for ((key, value) in this) {
            writableMap.putString(key, value)
        }
        return writableMap
    }
}
