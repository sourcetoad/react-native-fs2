package com.margelo.nitro.fs2

object RNFSFileTransformer {
  interface FileTransformer {
    fun onWriteFile(data: ByteArray): ByteArray
    fun onReadFile(
            data: ByteArray
    ): ByteArray // Retained as per original, though usage not seen in manager
  }

  @JvmStatic // If it needs to be accessed from Java as a static field
  var sharedFileTransformer: FileTransformer? = null
}
