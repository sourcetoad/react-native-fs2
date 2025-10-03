import Foundation

enum StreamError: LocalizedError {
    case notFound(path: String)
    case accessDenied(path: String)
    case ioError(message: String)
    case storageError(reason: String)
    case streamClosed(streamId: String)
    case streamInactive(streamId: String)
    case invalidStream(streamId: String)
    case bufferError(message: String)
    
    var errorDescription: String? {
        switch self {
        case .notFound(let path):
            return "ENOENT: File does not exist: \(path)"
        case .accessDenied(let path):
            return "EACCES: Permission denied: \(path)"
        case .ioError(let message):
            return "I/O error: \(message)"
        case .storageError(let reason):
            return "Storage error: \(reason)"
        case .streamClosed(let streamId):
            return "EPIPE: Stream is closed: \(streamId)"
        case .streamInactive(let streamId):
            return "EPIPE: Stream is not active: \(streamId)"
        case .invalidStream(let streamId):
            return "ENOENT: No such stream: \(streamId)"
        case .bufferError(let message):
            return "Buffer error: \(message)"
        }
    }
} 