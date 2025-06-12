package com.margelo.nitro.fs2

import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise

class MediaStore(): HybridMediaStoreSpec() {
    override fun mediaStoreCreateFile(
        fileDescriptor: FileDescriptor,
        mediaCollection: MediaCollectionType
    ): Promise<String> {
        TODO("Not yet implemented")
    }

    override fun mediaStoreUpdateFile(
        uri: String,
        fileDescriptor: FileDescriptor,
        mediaCollection: MediaCollectionType
    ): Promise<String> {
        TODO("Not yet implemented")
    }

    override fun mediaStoreWriteToFile(uri: String, sourceFilePath: String): Promise<Unit> {
        TODO("Not yet implemented")
    }

    override fun mediaStoreCopyFromFile(
        sourceFilePath: String,
        fileDescriptor: FileDescriptor,
        mediaCollection: MediaCollectionType
    ): Promise<String> {
        TODO("Not yet implemented")
    }

    override fun mediaStoreQueryFiles(searchOptions: MediaStoreSearchOptions): Promise<Array<MediaStoreFile>> {
        TODO("Not yet implemented")
    }

    override fun mediaStoreDeleteFile(uri: String): Promise<Boolean> {
        TODO("Not yet implemented")
    }
}