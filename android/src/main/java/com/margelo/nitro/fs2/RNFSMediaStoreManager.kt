package com.margelo.nitro.fs2

import com.margelo.nitro.fs2.Utils.FileDescription
import com.margelo.nitro.fs2.Utils.MediaStoreQuery

import android.app.RecoverableSecurityException
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

@ReactModule(name = RNFSMediaStoreManager.MODULE_NAME)
class RNFSMediaStoreManager(private val reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  enum class MediaTypeEnum {
    Audio,
    Image,
    Video,
    Download,
  }

  companion object {
    const val MODULE_NAME = "RNFSMediaStoreManager"

    // Constants for JS to use for mediaType string
    private val RNFSMediaStoreTypeAudio = MediaTypeEnum.Audio.toString()
    private val RNFSMediaStoreTypeImage = MediaTypeEnum.Image.toString()
    private val RNFSMediaStoreTypeVideo = MediaTypeEnum.Video.toString()
    private val RNFSMediaStoreTypeDownload = MediaTypeEnum.Download.toString()

    private fun getMediaUri(mt: MediaTypeEnum): Uri? {
      return when (mt) {
        MediaTypeEnum.Audio ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                  MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                } else {
                  MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                }
        MediaTypeEnum.Video ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                  MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                } else {
                  MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                }
        MediaTypeEnum.Image ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                  MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                } else {
                  MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                }
        MediaTypeEnum.Download ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                  MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                } else {
                  null // Downloads URI only available on Q+
                }
      }
    }

    private fun getRelativePath(mt: MediaTypeEnum): String? { // ctx is not used
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        when (mt) {
          MediaTypeEnum.Audio -> Environment.DIRECTORY_MUSIC
          MediaTypeEnum.Video -> Environment.DIRECTORY_MOVIES
          MediaTypeEnum.Image -> Environment.DIRECTORY_PICTURES
          MediaTypeEnum.Download -> Environment.DIRECTORY_DOWNLOADS
        }
      } else {
        null // Relative path for MediaStore mostly a Q+ concept
      }
    }
  }

  override fun getName(): String {
    return MODULE_NAME
  }

  @ReactMethod
  fun createMediaFile(filedata: ReadableMap, mediaTypeStr: String?, promise: Promise) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))
    ) {
      promise.reject("RNFS2.createMediaFile", "Invalid filedata: $filedata")
      return
    }
    if (mediaTypeStr == null) {
      promise.reject("RNFS2.createMediaFile", "Invalid mediatype")
      return
    }
    val mediaType =
            try {
              MediaTypeEnum.valueOf(mediaTypeStr)
            } catch (e: IllegalArgumentException) {
              promise.reject("RNFS2.createMediaFile", "Invalid mediatype string: $mediaTypeStr")
              return
            }

    val file =
            FileDescription(
                filedata.getString("name")!!,
                filedata.getString("mimeType")!!,
                filedata.getString("parentFolder")!!
            )
    val res = createNewMediaFile(file, mediaType, promise, reactContext.applicationContext)

    if (res != null) {
      promise.resolve(res.toString())
    } else {
      // createNewMediaFile should have rejected the promise if it returns null and an error
      // occurred
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.reject(
                "RNFS2.createMediaFile",
                "File could not be created (Android version < Q not supported for this op)"
        )
      } else {
        promise.reject("RNFS2.createMediaFile", "File could not be created (unknown error)")
      }
    }
  }

  @ReactMethod
  fun updateMediaFile(
          fileUriStr: String,
          filedata: ReadableMap,
          mediaTypeStr: String?,
          promise: Promise
  ) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))
    ) {
      promise.reject("RNFS2.updateMediaFile", "Invalid filedata: $filedata")
      return
    }
    if (mediaTypeStr == null) {
      promise.reject("RNFS2.updateMediaFile", "Invalid mediatype")
      return
    }
    val mediaType =
            try {
              MediaTypeEnum.valueOf(mediaTypeStr)
            } catch (e: IllegalArgumentException) {
              promise.reject("RNFS2.updateMediaFile", "Invalid mediatype string: $mediaTypeStr")
              return
            }

    val file =
            FileDescription(
                    filedata.getString("name")!!,
                    filedata.getString("mimeType")!!,
                    filedata.getString("parentFolder")!!
            )
    val fileUri = Uri.parse(fileUriStr)
    val success =
            updateExistingMediaFile(
                    fileUri,
                    file,
                    mediaType,
                    promise,
                    reactContext.applicationContext
            )
    if (success) {
      promise.resolve("Success")
    } // else: updateExistingMediaFile should have rejected promise
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  @ReactMethod
  fun writeToMediaFile(fileUriStr: String, path: String, transformFile: Boolean, promise: Promise) {
    val success =
            writeToMediaFileInternal(
                    Uri.parse(fileUriStr),
                    path,
                    transformFile,
                    false,
                    promise,
                    reactContext.applicationContext
            )
    if (success) {
      promise.resolve("Success")
    } // else: writeToMediaFileInternal should have rejected promise
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  @ReactMethod
  fun copyToMediaStore(
          filedata: ReadableMap,
          mediaTypeStr: String?,
          path: String?,
          promise: Promise
  ) {
    if (!(filedata.hasKey("name") && filedata.hasKey("parentFolder") && filedata.hasKey("mimeType"))
    ) {
      promise.reject("RNFS2.copyToMediaStore", "Invalid filedata: $filedata")
      return
    }
    if (mediaTypeStr == null) {
      promise.reject("RNFS2.copyToMediaStore", "Invalid mediatype")
      return
    }
    val mediaType =
            try {
              MediaTypeEnum.valueOf(mediaTypeStr)
            } catch (e: IllegalArgumentException) {
              promise.reject("RNFS2.copyToMediaStore", "Invalid mediatype string: $mediaTypeStr")
              return
            }
    if (path == null) {
      promise.reject("RNFS2.copyToMediaStore", "Invalid path")
      return
    }

    try {
      val srcFile = File(path)
      if (!srcFile.exists()) {
        promise.reject("RNFS2.copyToMediaStore", "No such file ('$path')")
        return
      }
    } catch (e: Exception) {
      promise.reject("RNFS2.copyToMediaStore", "Error accessing source file: ${e.message}", e)
      return
    }

    val resolver = reactContext.contentResolver
    var fileUri: Uri? = null

    try {
      val fileDesc =
              FileDescription(
                      filedata.getString("name")!!,
                      filedata.getString("mimeType")!!,
                      filedata.getString("parentFolder")!!
              )

      fileUri = createNewMediaFile(fileDesc, mediaType, promise, reactContext.applicationContext)

      if (fileUri == null) {
        // createNewMediaFile should have rejected if it returns null and error, or if version < Q
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
        ) { // Redundant check if createNewMediaFile handles it
          promise.reject(
                  "RNFS2.copyToMediaStore",
                  "Failed to create initial media file entry (null URI from createNewMediaFile on Q+)."
          )
        } // else: already rejected by createNewMediaFile for < Q
        return
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val pendingValues = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 1) }
        if (resolver.update(fileUri, pendingValues, null, null) == 0) {
          cleanupMediaStoreEntry(fileUri, resolver)
          promise.reject(
                  "RNFS2.copyToMediaStore",
                  "Failed to mark media file as pending (0 rows updated). Original entry cleaned up."
          )
          return
        }
      }

      val writeSuccessful =
              writeToMediaFileInternal(
                      fileUri,
                      path,
                      false,
                      true,
                      promise,
                      reactContext.applicationContext
              )

      if (writeSuccessful) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val commitValues = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
          if (resolver.update(fileUri, commitValues, null, null) > 0) {
            promise.resolve(fileUri.toString())
          } else {
            cleanupMediaStoreEntry(fileUri, resolver) // Entry has data but failed to unmark pending
            promise.reject(
                    "RNFS2.copyToMediaStore",
                    "Failed to commit media file (unmark as pending - 0 rows updated). Entry with data cleaned up."
            )
          }
        } else { // For pre-Q, no pending state, so write success is enough
          promise.resolve(fileUri.toString())
        }
      } // If writeSuccessful is false, writeToMediaFileInternal has already rejected and handled
      // cleanup.
    } catch (e: Exception) {
      if (fileUri != null) {
        cleanupMediaStoreEntry(fileUri, resolver)
      }
      promise.reject(
              "RNFS2.copyToMediaStore",
              "Unexpected error during copyToMediaStore: ${e.message}",
              e
      )
    }
  }

  @ReactMethod
  fun query(queryParams: ReadableMap, promise: Promise) {
    try {
      val mediaStoreQuery =
          queryParams.getString("uri")?.let {
              MediaStoreQuery(
                  it,
                  queryParams.getString("fileName")!!,
                  queryParams.getString("relativePath")!!,
                  queryParams.getString("mediaType")
              )
          }
      val queryResult = mediaStoreQuery?.let { queryInternal(it, promise, reactContext.applicationContext) }
      // queryInternal resolves the promise directly or returns null
      if (queryResult == null && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        // Let queryInternal handle the rejection for < Q
      } else if (queryResult == null && !promiseHasBeenResolved(promise)) {
        // If Q+ and queryInternal returned null, means no results, resolve promise with null
        promise.resolve(null)
      } else if (queryResult != null) {
        promise.resolve(queryResult)
      }
    } catch (e: Exception) {
      promise.reject("RNFS2.query", "Error during query: ${e.message}")
    }
  }

  // Helper to check if a promise has been resolved/rejected - React Native promises don't have a
  // public status API.
  // This is a trick and might not be reliable. It's better if called methods always reject on
  // error.
  private fun promiseHasBeenResolved(promise: Promise): Boolean {
    // This is a placeholder. In a real scenario, ensure all paths in called functions reject or
    // resolve.
    // For now, assume if we reach here and the called function might have resolved, it has.
    return false // Defaulting to false to be safe and allow explicit resolve/reject.
  }

  @ReactMethod
  fun delete(fileUriStr: String, promise: Promise) {
    try {
      val uri = Uri.parse(fileUriStr)
      val resolver = reactContext.contentResolver
      val rowsDeleted = resolver.delete(uri, null, null)
      promise.resolve(rowsDeleted > 0)
    } catch (e: Exception) {
      var errorCode = "RNFS2.delete"
      var errorMessage = "Error deleting file: ${e.message}"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && e is RecoverableSecurityException) {
        // This is how you'd normally request permission, but we can't launch an IntentSender from
        // here directly
        // promise.reject("ERR_RECOVERABLE_SECURITY_DELETE", "App needs user permission to delete
        // this file. ${e.message}", e)
        // For now, just report the error
        errorCode = "ERR_RECOVERABLE_SECURITY_DELETE"
        errorMessage =
                "App needs user permission to delete this file. RecoverableSecurityException: ${e.message}"
      } else if (e is SecurityException) {
        errorCode = "ERR_SECURITY_EXCEPTION_DELETE"
        errorMessage = "SecurityException occurred during delete: ${e.message}"
      }
      promise.reject(errorCode, errorMessage, e)
    }
  }

  private fun createNewMediaFile(
          file: FileDescription,
          mediaType: MediaTypeEnum,
          promise: Promise,
          ctx: Context
  ): Uri? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject(
              "RNFS2.createNewMediaFile",
              "Creating MediaStore entries this way is not supported below Android Q."
      )
      return null
    }
    val resolver = ctx.contentResolver
    val relativePath =
            getRelativePath(mediaType) ?: Environment.DIRECTORY_DOCUMENTS // Fallback for safety
    val mimeType = file.mimeType

    val fileDetails =
            ContentValues().apply {
              put(MediaStore.MediaColumns.DATE_ADDED, System.currentTimeMillis() / 1000)
              put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000)
              put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
              put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
              put(MediaStore.MediaColumns.RELATIVE_PATH, "$relativePath/${file.parentFolder}")
              // IS_PENDING will be set by the caller (copyToMediaStore) if needed
            }

    val mediaUri = getMediaUri(mediaType)
    if (mediaUri == null) { // e.g. Downloads on pre-Q
      promise.reject(
              "RNFS2.createNewMediaFile",
              "Unsupported media type or Android version for URI: $mediaType"
      )
      return null
    }

    return try {
      resolver.insert(mediaUri, fileDetails)
    } catch (e: Exception) {
      promise.reject(
              "RNFS2.createNewMediaFile",
              "Failed to insert MediaStore entry: ${e.message}",
              e
      )
      null
    }
  }

  private fun updateExistingMediaFile(
          fileUri: Uri,
          file: FileDescription,
          mediaType: MediaTypeEnum,
          promise: Promise,
          ctx: Context
  ): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject(
              "RNFS2.updateExistingMediaFile",
              "Updating MediaStore entries this way is not supported below Android Q."
      )
      return false
    }
    try {
      val resolver = ctx.contentResolver
      val relativePath = getRelativePath(mediaType) ?: Environment.DIRECTORY_DOCUMENTS
      val mimeType = file.mimeType

      val fileDetails =
              ContentValues().apply {
                put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "$relativePath/${file.parentFolder}")
              }

      val rowsUpdated =
              try {
                resolver.update(fileUri, fileDetails, null, null)
              } catch (se: SecurityException) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                                se is RecoverableSecurityException
                ) {
                  // Ideally, you would launch the intent sender from se.userAction.actionIntent
                  // For now, just inform JS that permission is needed.
                  promise.reject(
                          "ERR_RECOVERABLE_SECURITY",
                          "App needs user permission to modify this file. ${se.message}",
                          se
                  )
                } else {
                  promise.reject(
                          "ERR_SECURITY_EXCEPTION",
                          "SecurityException occurred during update: ${se.message}",
                          se
                  )
                }
                return false
              }
      if (rowsUpdated <= 0) {
        promise.reject(
                "RNFS2.updateExistingMediaFile",
                "Failed to update MediaStore entry (0 rows affected)."
        )
        return false
      }
      return true
    } catch (e: Exception) {
      promise.reject("RNFS2.updateExistingMediaFile", "Error updating file: ${e.message}", e)
      return false
    }
  }

  private fun cleanupMediaStoreEntry(fileUri: Uri, resolver: ContentResolver) {
    try {
      resolver.delete(fileUri, null, null)
    } catch (deleteError: Exception) {
      Log.e("RNFS2", "Failed to cleanup MediaStore entry: ${deleteError.message}")
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q) // This method is Q+
  private fun writeToMediaFileInternal(
          fileUri: Uri?,
          filePath: String,
          transformFile: Boolean,
          shouldCleanupOnFailure: Boolean,
          promise: Promise,
          ctx: Context
  ): Boolean {
    if (fileUri == null) {
      promise.reject("RNFS2.writeToMediaFile", "Invalid file URI (null)")
      return false
    }

    val resolver = ctx.contentResolver
    try {
      val src = File(filePath)
      if (!src.exists()) {
        promise.reject("ENOENT", "No such file ('$filePath')")
        return false
      }

      // Use try-with-resources for ParcelFileDescriptor, FileInputStream, and FileOutputStream
      resolver.openFileDescriptor(fileUri, "w")?.use { parcelFileDescriptor ->
        FileInputStream(src).use { fin ->
          FileOutputStream(parcelFileDescriptor.fileDescriptor).use { fout ->
            if (transformFile) {
              val bytes = fin.readBytes()
              if (RNFSFileTransformer.sharedFileTransformer == null) {
                throw IllegalStateException(
                        "Write to media file with transform was specified but the shared file transformer is not set"
                )
              }
              val transformedBytes = RNFSFileTransformer.sharedFileTransformer!!.onWriteFile(bytes)
              fout.write(transformedBytes)
            } else {
              val buf = ByteArray(1024 * 10)
              var len: Int
              while (fin.read(buf).also { len = it } > 0) {
                fout.write(buf, 0, len)
              }
            }
          }
        }
      }
              ?: run {
                promise.reject(
                        "RNFS2.writeToMediaFile",
                        "Failed to open file descriptor for $fileUri"
                )
                return false
              }
      // The redundant openOutputStream and close from original Java is removed.
      // Data should be flushed by FileOutputStream.close() called by use block.

      return true
    } catch (e: Exception) {
      if (shouldCleanupOnFailure) {
        cleanupMediaStoreEntry(fileUri, resolver)
      }
      promise.reject(
              "RNFS2.writeToMediaFile",
              "Failed to write to MediaStore URI $fileUri: ${e.message}",
              e
      )
      return false
    }
  }

  private fun queryInternal(
          queryParams: MediaStoreQuery,
          promise: Promise,
          ctx: Context
  ): WritableMap? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject(
              "RNFS2.query",
              "Querying MediaStore this way is not supported below Android Q."
      )
      return null
    }

    var cursor: Cursor? = null
    try {
      val resolver = ctx.contentResolver
      val queryResultsMap = Arguments.createMap()

      val mediaTypeEnum =
              try {
                MediaTypeEnum.valueOf(queryParams.mediaType ?: "")
              } catch (e: IllegalArgumentException) {
                null
              }

      val mediaURI: Uri =
              if (queryParams.uri.isNotEmpty()) {
                Uri.parse(queryParams.uri)
              } else if (mediaTypeEnum != null) {
                getMediaUri(mediaTypeEnum)
                        ?: run {
                          promise.reject(
                                  "RNFS2.query",
                                  "Unsupported media type for URI query: ${queryParams.mediaType}"
                          )
                          return null
                        }
              } else {
                promise.reject("RNFS2.query", "MediaType must be provided if URI is empty.")
                return null
              }

      val projection =
              arrayOf(
                      MediaStore.MediaColumns._ID,
                      MediaStore.MediaColumns.DISPLAY_NAME,
                      MediaStore.MediaColumns.RELATIVE_PATH
              )
      var selection: String? = null
      var selectionArgs: Array<String>? = null

      if (queryParams.uri.isEmpty() && mediaTypeEnum != null
      ) { // Only apply filename/path if not querying specific URI
        val relativePathBase = getRelativePath(mediaTypeEnum) ?: Environment.DIRECTORY_DOCUMENTS
        // Ensure queryParams.relativePath doesn't start or end with /
        val cleanRelativePath = queryParams.relativePath.trim('/')
        selection =
                "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?"
        // MediaStore relative_path includes trailing slash
        selectionArgs = arrayOf(queryParams.fileName, "$relativePathBase/$cleanRelativePath/")
      }

      cursor = resolver.query(mediaURI, projection, selection, selectionArgs, null)

      if (cursor != null && cursor.moveToFirst()) {
        val idColumnIndex = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
        val id = cursor.getLong(idColumnIndex)
        val contentUri = Uri.withAppendedPath(mediaURI, id.toString())
        queryResultsMap.putString("contentUri", contentUri.toString())
        // Do not resolve promise here, return the map to the public query method
        return queryResultsMap
      } else {
        // No results, public query method will resolve with null
        return null
      }
    } catch (e: Exception) {
      promise.reject("RNFS2.query.internal", "Error during MediaStore query: ${e.message}", e)
      return null
    } finally {
      cursor?.close()
    }
  }

  override fun getConstants(): Map<String, Any> {
    return mapOf(
            RNFSMediaStoreTypeAudio to RNFSMediaStoreTypeAudio,
            RNFSMediaStoreTypeImage to RNFSMediaStoreTypeImage,
            RNFSMediaStoreTypeVideo to RNFSMediaStoreTypeVideo,
            RNFSMediaStoreTypeDownload to RNFSMediaStoreTypeDownload
    )
  }
}
