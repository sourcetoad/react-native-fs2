package com.margelo.nitro.fs2

import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import androidx.core.net.toUri
import com.facebook.react.bridge.ReactApplicationContext
import com.margelo.nitro.fs2.utils.Fs2Util

class RNFSManager(private val context: ReactApplicationContext) {
    companion object {
        const val FILE_TYPE_REGULAR = 0
        const val FILE_TYPE_DIRECTORY = 1

        // Directory path providers (can be enhanced or made more granular)
        fun getDocumentDirectoryPath(context: ReactApplicationContext): String = context.filesDir.absolutePath
        fun getTemporaryDirectoryPath(context: ReactApplicationContext): String = context.cacheDir.absolutePath
        fun getPicturesDirectoryPath(): String =
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                .absolutePath
        fun getCachesDirectoryPath(context: ReactApplicationContext): String = context.cacheDir.absolutePath
        fun getDownloadDirectoryPath(): String =
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                .absolutePath
        fun getExternalStorageDirectoryPath(): String? =
            Environment.getExternalStorageDirectory()?.absolutePath
        fun getExternalDirectoryPath(context: ReactApplicationContext): String? =
            context.getExternalFilesDir(null)?.absolutePath
        fun getExternalCachesDirectoryPath(context: ReactApplicationContext): String? =
            context.externalCacheDir?.absolutePath
    }

    private fun getFileUri(filepath: String, isDirectoryAllowed: Boolean = false): Uri {
        val uri = filepath.toUri()
        if (uri.scheme == null) {
            val file = File(filepath)
            if (!isDirectoryAllowed && file.isDirectory) {
                throw IORejectionException(
                    "EISDIR",
                    "EISDIR: illegal operation on a directory, read '$filepath'"
                )
            }
            return "file://$filepath".toUri()
        }
        return uri
    }

    private fun getOriginalFilepath(filepath: String, isDirectoryAllowed: Boolean = false): String {
        val uri = getFileUri(filepath, isDirectoryAllowed)
        var originalFilepath = filepath
        if ("content" == uri.scheme) {
            try {
                context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val columnIndex = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
                        originalFilepath = cursor.getString(columnIndex)
                    }
                }
            } catch (e: IllegalArgumentException) {
                // Ignored in original code
            }
        }
        return originalFilepath
    }

    private fun getInputStream(filepath: String): InputStream {
        val uri = getFileUri(filepath)
        try {
            return context.contentResolver.openInputStream(uri)
                ?: throw IORejectionException(
                    "ENOENT",
                    "ENOENT: could not open an input stream for '$filepath'"
                )
        } catch (ex: FileNotFoundException) {
            throw IORejectionException("ENOENT", "ENOENT: ${ex.message}, open '$filepath'")
        }
    }

    private fun getWriteAccessByAPILevel(): String {
        return if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) "w" else "rwt"
    }

    private fun getOutputStream(filepath: String, append: Boolean): OutputStream {
        val uri = getFileUri(filepath)
        try {
            return context.contentResolver.openOutputStream(
                uri,
                if (append) "wa" else getWriteAccessByAPILevel()
            )
                ?: throw IORejectionException(
                    "ENOENT",
                    "ENOENT: could not open an output stream for '$filepath'"
                )
        } catch (ex: FileNotFoundException) {
            throw IORejectionException("ENOENT", "ENOENT: ${ex.message}, open '$filepath'")
        }
    }

    private fun getInputStreamBytes(inputStream: InputStream): ByteArray {
        ByteArrayOutputStream().use { byteBuffer ->
            val buffer = ByteArray(1024)
            var len: Int
            while (inputStream.read(buffer).also { len = it } != -1) {
                byteBuffer.write(buffer, 0, len)
            }
            return byteBuffer.toByteArray()
        }
    }

    fun writeFile(filepath: String, data: ByteArray) {
        getOutputStream(filepath, false).use { outputStream -> outputStream.write(data) }
    }

    fun appendFile(filepath: String, data: ByteArray) {
        getOutputStream(filepath, true).use { outputStream -> outputStream.write(data) }
    }

    fun write(filepath: String, data: ByteArray, position: Int) {
        if (position < 0) { // Append
            getOutputStream(filepath, true).use { outputStream -> outputStream.write(data) }
        } else {
            val file = File(getOriginalFilepath(filepath, false))

            // Ensure parent directories exist
            val parent = file.parentFile
            if (parent != null && !parent.exists()) {
                parent.mkdirs()
            }

            // Create file if it doesn't exist
            if (!file.exists()) {
                file.createNewFile()
            }

            RandomAccessFile(file, "rw").use { randomAccessFile ->
                randomAccessFile.seek(position.toLong())
                randomAccessFile.write(data)
            }
        }
    }

    fun exists(filepath: String): Boolean {
        // Let exceptions propagate to be handled by the caller (Fs2.kt)
        val file = File(getOriginalFilepath(filepath, true))
        return file.exists()
    }

    fun readFile(filepath: String): ByteArray {
        getInputStream(filepath).use { inputStream ->
            return getInputStreamBytes(inputStream)
        }
    }

    fun read(filepath: String, length: Int, position: Int): ByteArray {
        getInputStream(filepath).use { inputStream ->
            val buffer = ByteArray(length)
            inputStream.skip(position.toLong())
            val bytesRead = inputStream.read(buffer, 0, length)

            // If we read fewer bytes than requested, return a truncated array
            return if (bytesRead < length) buffer.copyOf(bytesRead) else buffer
        }
    }

    fun hash(filepath: String, algorithm: String): String {
        val algorithms =
            mapOf(
                "md5" to "MD5",
                "sha1" to "SHA-1",
                "sha224" to "SHA-224",
                "sha256" to "SHA-256",
                "sha384" to "SHA-384",
                "sha512" to "SHA-512"
            )

        if (!algorithms.containsKey(algorithm.lowercase())) {
            throw IllegalArgumentException("Invalid hash algorithm: $algorithm")
        }

        val file = File(getOriginalFilepath(filepath, false))

        if (file.isDirectory) {
            throw IORejectionException(
                "EISDIR",
                "EISDIR: illegal operation on a directory, read '$filepath'"
            )
        }
        if (!file.exists()) {
            throw IORejectionException(
                "ENOENT",
                "ENOENT: no such file or directory, open '$filepath'"
            )
        }

        val md = MessageDigest.getInstance(algorithms[algorithm.lowercase()])
        FileInputStream(file).use { inputStream -> // Use the file path directly for FileInputStream
            val buffer = ByteArray(1024 * 10)
            var read: Int
            while (inputStream.read(buffer).also { read = it } != -1) {
                md.update(buffer, 0, read)
            }
        }

        val hexString = StringBuilder()
        for (digestByte in md.digest()) {
            hexString.append(String.format("%02x", digestByte))
        }
        return hexString.toString()
    }

    fun moveFile(filepath: String, destPath: String) {
        val inFile =
            File(getOriginalFilepath(filepath, false)) // Use original path for file operations
        val outFile =
            File(getOriginalFilepath(destPath, false)) // Use original path for file operations

        if (outFile.exists()) { // Added check to prevent overwriting an existing file by renameTo
            if (!outFile.delete()) {
                throw IOException("Failed to delete existing destination file: $destPath")
            }
        }

        if (!inFile.renameTo(outFile)) {
            copyFile(filepath, destPath) // Original paths from parameters
            if (!inFile.delete()) {
                // Log or throw a more specific error if deletion after copy fails
                // For simplicity, let's assume it mostly works or the copy is sufficient
            }
        }
    }

    fun copyFile(filepath: String, destPath: String) {
        getInputStream(filepath).use { input ->
            getOutputStream(destPath, false).use { output ->
                val buffer = ByteArray(1024)
                var length: Int
                while (input.read(buffer).also { length = it } > 0) {
                    output.write(buffer, 0, length)
                }
            }
        }
    }

    data class FileStat(
        val name: String,
        val path: String,
        val size: Long,
        val type: Int, // FILE_TYPE_REGULAR or FILE_TYPE_DIRECTORY
        val lastModified: Long // mtime in seconds
    )

    fun readDir(directoryPath: String): List<FileStat> {
        val dir =
            File(
                getOriginalFilepath(directoryPath, true)
            ) // Use original path for directory listing
        if (!dir.exists()) throw IORejectionException(
            "ENOENT",
            "Folder does not exist: $directoryPath"
        )
        if (!dir.isDirectory)
            throw IORejectionException("ENOTDIR", "Path is not a directory: $directoryPath")

        return dir.listFiles()?.map { childFile ->
            FileStat(
                name = childFile.name,
                path = childFile.absolutePath,
                size = childFile.length(),
                type = if (childFile.isDirectory) FILE_TYPE_DIRECTORY else FILE_TYPE_REGULAR,
                lastModified = childFile.lastModified() / 1000
            )
        }
            ?: emptyList()
    }

    fun stat(filepath: String): NativeStatResult {
        val originalPath = getOriginalFilepath(filepath, true)
        val file = File(originalPath)

        if (!file.exists()) throw IORejectionException("ENOENT", "File does not exist: $filepath")

        return NativeStatResult(
            ctime = (file.lastModified() / 1000).toDouble(),
            mtime = (file.lastModified() / 1000).toDouble(),
            size = file.length().toDouble(),
            type = if (file.isDirectory) StatResultType.DIRECTORY else StatResultType.FILE,
            originalFilepath = originalPath,
            mode = null,
        )
    }

    fun unlink(filepath: String) {
        val file = File(getOriginalFilepath(filepath, true))
        if (!file.exists()) throw IORejectionException("ENOENT", "File does not exist: $filepath")
        deleteRecursive(file)
    }

    private fun deleteRecursive(fileOrDirectory: File) {
        if (fileOrDirectory.isDirectory) {
            fileOrDirectory.listFiles()?.forEach { child -> deleteRecursive(child) }
        }
        if (!fileOrDirectory.delete()) {
            // Optionally throw an error if deletion fails
            // Log.w("RNFSManager", "Failed to delete: ${fileOrDirectory.absolutePath}")
        }
    }

    fun mkdir(filepath: String, options: MkdirOptions?): Unit {
        val file = File(filepath)
        file.mkdirs() // Attempt to create directory and necessary parents.

        // throw an error if the directory could not be created
        if (!file.exists() || !file.isDirectory) { // Also check if it's actually a directory
            throw IOException("Directory could not be created or path is not a directory: $filepath")
        }
    }

    data class FSInfo(
        val totalSpace: Long, // Internal storage total space
        val freeSpace: Long, // Internal storage free space
        val totalSpaceEx: Long, // External storage total space (if available)
        val freeSpaceEx: Long // External storage free space (if available)
    )

    // For StatFs methods
    fun getFSInfo(): FSInfo {
        val internalPath = Environment.getDataDirectory()
        val stat = StatFs(internalPath.path)
        val totalSpace = stat.totalBytes
        val freeSpace = stat.freeBytes

        var totalSpaceEx = 0L
        var freeSpaceEx = 0L

        if (Environment.getExternalStorageState() == Environment.MEDIA_MOUNTED) {
            try {
                val externalPath = Environment.getExternalStorageDirectory()
                if (externalPath != null) {
                    val statEx = StatFs(externalPath.path)
                    totalSpaceEx = statEx.totalBytes
                    freeSpaceEx = statEx.freeBytes
                }
            } catch (e: Exception) {
                // External storage might not be available or accessible
                // Log.w("RNFSManager", "Could not get external storage info: ${e.message}")
            }
        }

        return FSInfo(totalSpace, freeSpace, totalSpaceEx, freeSpaceEx)
    }

    fun touch(filepath: String, mtime: Long, ctime: Long? = null): Boolean {
        // Java File API only supports setting lastModified time (mtime).
        // ctime (creation time or change time) is not directly settable.
        // We'll use mtime for lastModified.
        val file = File(getOriginalFilepath(filepath, false)) // Use original path
        return file.setLastModified(mtime * 1000) // Original was in seconds, convert to ms
    }
}
