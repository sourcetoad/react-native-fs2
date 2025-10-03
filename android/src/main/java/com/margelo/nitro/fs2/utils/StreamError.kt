package com.margelo.nitro.fs2.utils

sealed class StreamError : Exception() {
    data class NotFound(val path: String) : StreamError() {
        override val message: String = "ENOENT: File does not exist: $path"
    }
    
    data class AccessDenied(val path: String) : StreamError() {
        override val message: String = "EACCES: Permission denied: $path"
    }
    
    data class IOError(override val message: String) : StreamError()
    
    data class StorageError(val reason: String) : StreamError() {
        override val message: String = "Storage error: $reason"
    }
    
    data class StreamClosed(val streamId: String) : StreamError() {
        override val message: String = "EPIPE: Stream is closed: $streamId"
    }
    
    data class StreamInactive(val streamId: String) : StreamError() {
        override val message: String = "EPIPE: Stream is not active: $streamId"
    }
    
    data class InvalidStream(val streamId: String) : StreamError() {
        override val message: String = "ENOENT: No such stream: $streamId"
    }
    
    data class BufferError(override val message: String) : StreamError()
} 