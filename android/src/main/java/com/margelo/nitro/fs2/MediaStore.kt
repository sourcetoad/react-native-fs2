package com.margelo.nitro.fs2

import com.margelo.nitro.core.Promise
import com.margelo.nitro.fs2.utils.FsError
import com.margelo.nitro.fs2.utils.JsVisibleError
import androidx.core.net.toUri

class MediaStore(): HybridMediaStoreSpec() {
    private val mediaStoreManager = RNFSMediaStoreManager()

    /**
     * Builds the JS-facing error for [ex] without throwing it. See `Fs2.fsError`.
     */
    private fun fsError(context: String, ex: Exception): Throwable {
        // Already a JS-facing error carrying a formatted message - propagate it unchanged.
        if (ex is JsVisibleError) return ex

        // You can expand this for more specific error types as needed
        return FsError(ex.message ?: "Error in MediaStore operation: $context")
    }

    /** Throws the JS-facing error for [ex]. Every path throws, hence [Nothing]. */
    private fun reject(context: String, ex: Exception): Nothing = throw fsError(context, ex)

    override fun mediaStoreCreateFile(
        fileDescription: FileDescription,
        mediaCollection: MediaCollectionType
    ): Promise<String> {
        return Promise.async {
            try {
                val uri = mediaStoreManager.createMediaFile(fileDescription, mediaCollection)
                return@async uri.toString()
            } catch (e: Exception) {
                throw reject(fileDescription.name, e)
            }
        }
    }

    override fun mediaStoreUpdateFile(
        uri: String,
        fileDescription: FileDescription,
        mediaCollection: MediaCollectionType
    ): Promise<String> {
        return Promise.async {
            try {
                val updated = mediaStoreManager.updateMediaFile(uri.toUri(), fileDescription, mediaCollection)
                if (updated) {
                    return@async uri
                } else {
                    throw FsError("Failed to update file: $uri")
                }
            } catch (e: Exception) {
                throw reject(uri, e)
            }
        }
    }

    override fun mediaStoreWriteToFile(uri: String, sourceFilePath: String): Promise<Unit> {
        return Promise.async {
            try {
                val success = mediaStoreManager.writeToMediaFile(uri.toUri(), sourceFilePath)
                if (success) {
                    return@async
                } else {
                    throw FsError("Failed to write to file: $uri")
                }
            } catch (e: Exception) {
                throw reject(uri, e)
            }
        }
    }

    override fun mediaStoreCopyFromFile(
        sourceFilePath: String,
        fileDescription: FileDescription,
        mediaCollection: MediaCollectionType
    ): Promise<String> {
        return Promise.async {
            try {
                val uri = mediaStoreManager.copyToMediaStore(fileDescription, mediaCollection, sourceFilePath)
                return@async uri.toString()
            } catch (e: Exception) {
                throw reject(sourceFilePath, e)
            }
        }
    }

    override fun mediaStoreQueryFile(searchOptions: MediaStoreSearchOptions): Promise<MediaStoreFile?> {
        return Promise.async {
            try {
                // The spec types this `Promise<MediaStoreFile | undefined>`, so "no match" is a
                // resolved `undefined`, not a rejection.
                return@async mediaStoreManager.query(searchOptions)
            } catch (e: Exception) {
                throw reject(searchOptions.fileName ?: "query", e)
            }
        }
    }

    override fun mediaStoreDeleteFile(uri: String): Promise<Boolean> {
        return Promise.async {
            try {
                val deleted = mediaStoreManager.delete(uri.toUri())
                return@async deleted
            } catch (e: Exception) {
                throw reject(uri, e)
            }
        }
    }
}