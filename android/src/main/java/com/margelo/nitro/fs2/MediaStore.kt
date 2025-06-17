package com.margelo.nitro.fs2

import com.margelo.nitro.core.Promise
import androidx.core.net.toUri

class MediaStore(): HybridMediaStoreSpec() {
    private val mediaStoreManager = RNFSMediaStoreManager()

    private fun reject(context: String, ex: Exception): Throwable {
        // You can expand this for more specific error types as needed
        throw Error(ex.message ?: "Error in MediaStore operation: $context")
    }

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
                    throw Error("Failed to update file: $uri")
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
                    throw Error("Failed to write to file: $uri")
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
        val queryPromise:Promise<MediaStoreFile?> = Promise()

        try {
            val file = mediaStoreManager.query(searchOptions)

            if (file != null) {
                queryPromise.resolve(file)
            } else {
                println("File not found: ${searchOptions.fileName}")
                queryPromise.reject(Error("File not found: ${searchOptions.fileName}"))
            }
        } catch (e: Exception) {
            throw reject(searchOptions.fileName ?: "query", e)
        }

        return queryPromise
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