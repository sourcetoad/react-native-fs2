package com.margelo.nitro.fs2

import android.app.RecoverableSecurityException
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.FileUtils
import android.provider.MediaStore
import android.util.Log
import androidx.core.net.toUri
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

import com.margelo.nitro.NitroModules

class RNFSMediaStoreManager {
    private val context = NitroModules.applicationContext
        ?: throw IllegalStateException("NitroModules.applicationContext is null")

    companion object {
        private const val BUFFER_SIZE = 10240
        private fun getMediaUri(mt: MediaCollectionType): Uri? {
            return when (mt) {
                MediaCollectionType.AUDIO ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                        MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

                MediaCollectionType.VIDEO ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                        MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else MediaStore.Video.Media.EXTERNAL_CONTENT_URI

                MediaCollectionType.IMAGE ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else MediaStore.Images.Media.EXTERNAL_CONTENT_URI

                MediaCollectionType.DOWNLOAD ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                        MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else null
            }
        }

        private fun getRelativePath(mt: MediaCollectionType): String {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return when (mt) {
                    MediaCollectionType.AUDIO -> Environment.DIRECTORY_MUSIC
                    MediaCollectionType.VIDEO -> Environment.DIRECTORY_MOVIES
                    MediaCollectionType.IMAGE -> Environment.DIRECTORY_PICTURES
                    MediaCollectionType.DOWNLOAD -> Environment.DIRECTORY_DOWNLOADS
                }
            } else {
                throw UnsupportedOperationException(
                "ENOTSUP: MediaStore requires Android 10 (API 29) or newer"
            )
            }
        }
    }

    fun createMediaFile(file: FileDescription, mediaType: MediaCollectionType): Uri {
        val resolver = context.contentResolver
        val fileDetails =
            ContentValues().apply {
                put(MediaStore.MediaColumns.DATE_ADDED, System.currentTimeMillis() / 1000)
                put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000)
                put(MediaStore.MediaColumns.MIME_TYPE, file.mimeType)
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    getRelativePath(mediaType) + '/' + file.parentFolder
                )
            }
        val mediaUri =
            getMediaUri(mediaType)
                ?: throw IOException("Failed to get MediaStore URI for type $mediaType")
        return resolver.insert(mediaUri, fileDetails)
            ?: throw IOException("File could not be created in MediaStore")
    }

    fun updateMediaFile(
        fileUri: Uri,
        file: FileDescription,
        mediaType: MediaCollectionType
    ): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
            throw UnsupportedOperationException(
                "ENOTSUP: MediaStore requires Android 10 (API 29) or newer"
            )
        val resolver = context.contentResolver
        val fileDetails =
            ContentValues().apply {
                put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000)
                put(MediaStore.MediaColumns.MIME_TYPE, file.mimeType)
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    getRelativePath(mediaType) + '/' + file.parentFolder
                )
            }
        return try {
            val rowsUpdated = resolver.update(fileUri, fileDetails, null, null)
            rowsUpdated > 0
        } catch (e: SecurityException) {
            if (e is RecoverableSecurityException) {
                throw SecurityException("App needs user permission to modify this file: ${e.message}")
            } else {
                throw SecurityException("SecurityException occurred during update: ${e.message}")
            }
        }
    }

    private fun getSourceUri(path: String): Uri {
        val uri = path.toUri()
        return if (uri.scheme == null) "file://$path".toUri() else uri
    }

    private fun getSourceInputStream(path: String): InputStream =
        context.contentResolver.openInputStream(getSourceUri(path))
            ?: throw IOException("Could not open input stream for: $path")

    fun writeToMediaFile(fileUri: Uri, filePath: String, transformFile: Boolean = false): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
            throw UnsupportedOperationException(
                "ENOTSUP: MediaStore requires Android 10 (API 29) or newer"
            )
        val resolver = context.contentResolver
        try {
            getSourceInputStream(filePath).use { source ->
                val descr = resolver.openFileDescriptor(fileUri, "w")
                    ?: throw IOException("Failed to open file descriptor")
                descr.use {
                    FileOutputStream(it.fileDescriptor).use { out ->
                        if (transformFile) {
                            val transformer = RNFSFileTransformer.sharedFileTransformer
                                ?: throw IllegalStateException(
                                    "Write to media file with transform was specified but the shared file transformer is not set"
                                )
                            out.write(transformer.onWriteFile(source.readBytes()))
                        } else {
                            FileUtils.copy(source, out)
                        }
                    }
                }
            }
            return true
        } catch (e: Exception) {
            throw IOException("Failed to write file: ${e.message}", e)
        }
    }

    fun copyToMediaStore(file: FileDescription, mediaType: MediaCollectionType, path: String): Uri {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
            throw UnsupportedOperationException(
                "ENOTSUP: MediaStore requires Android 10 (API 29) or newer"
            )
        val resolver = context.contentResolver
        try {
            getSourceInputStream(path).close()
        } catch (e: IOException) {
            throw IORejectionException("ENOENT", "Source not accessible: $path")
        }
        val fileUri = createMediaFile(file, mediaType)
        try {
            val pendingValues = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 1) }
            if (resolver.update(fileUri, pendingValues, null, null) == 0) {
                throw IOException(
                    "Failed to mark media file as pending (0 rows updated)."
                )
            }
            val writeSuccessful = writeToMediaFile(fileUri, path, false)
            if (writeSuccessful) {
                val commitValues =
                    ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                if (resolver.update(fileUri, commitValues, null, null) > 0) {
                    return fileUri
                } else {
                    throw IOException(
                        "Failed to commit media file (unmark as pending - 0 rows updated)."
                    )
                }
            } else {
                throw IOException("Failed to write file to MediaStore.")
            }
        } catch (e: Exception) {
            cleanupMediaStoreEntry(fileUri, resolver)
            throw IOException("Unexpected error during copyToMediaStore: ${e.message}", e)
        }
    }

    fun query(query: MediaStoreSearchOptions): MediaStoreFile? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
            throw UnsupportedOperationException(
                "ENOTSUP: MediaStore requires Android 10 (API 29) or newer"
            )
        var cursor: Cursor? = null

        try {
            val resolver = context.contentResolver
            val queryUri:String = query.uri ?: ""
            val queryMediaType: String = query.mediaType.toString()
            val queryFilename: String = query.fileName ?: ""
            val queryRelativePath: String = query.relativePath ?: ""

            val mediaCollectionType = try {
                MediaCollectionType.valueOf(queryMediaType)
            } catch (e: IllegalArgumentException) {
                Log.e("RNFS2", "Invalid media type provided: $queryMediaType")
                return null
            }

            val mediaURI =
                if (queryUri.isNotEmpty()) queryUri.toUri()
                else getMediaUri(mediaCollectionType)
            val projection =
                arrayOf(
                    MediaStore.MediaColumns._ID,
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.DATE_ADDED,
                    MediaStore.MediaColumns.DATE_MODIFIED,
                    MediaStore.MediaColumns.RELATIVE_PATH
                )
            val selection: String?
            val selectionArgs: Array<String>?
            if (queryUri.isEmpty()) {
                val relativePath = getRelativePath(mediaCollectionType)
                selection =
                    MediaStore.MediaColumns.DISPLAY_NAME +
                            " = ? AND " +
                            MediaStore.MediaColumns.RELATIVE_PATH +
                            " = ?"
                selectionArgs = arrayOf(queryFilename, "$relativePath/${queryRelativePath}/")
            } else {
                selection = null
                selectionArgs = null
            }
            cursor = resolver.query(mediaURI!!, projection, selection, selectionArgs, null)
            if (cursor != null && cursor.moveToFirst()) {
                val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                val name = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME))
                val mimeType = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE))
                val size = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE))
                val dateAdded = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED))
                val dateModified = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED))
                val relativePath = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH))
                val fileUri = Uri.withAppendedPath(mediaURI, id.toString())
                return MediaStoreFile(
                    uri = fileUri.toString(),
                    name = name,
                    mimeType = mimeType,
                    size = size.toDouble(),
                    dateAdded = dateAdded,
                    dateModified = dateModified,
                    relativePath = relativePath
                )
            }
            return null
        } finally {
            cursor?.close()
        }
    }

    fun delete(fileUri: Uri): Boolean {
        val resolver = context.contentResolver
        return resolver.delete(fileUri, null, null) > 0
    }

    private fun cleanupMediaStoreEntry(fileUri: Uri, resolver: ContentResolver) {
        try {
            resolver.delete(fileUri, null, null)
        } catch (deleteError: Exception) {
            Log.e("RNFS2", "Failed to cleanup MediaStore entry: ${deleteError.message}")
        }
    }
}
