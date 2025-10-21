import Foundation

/// A thread-safe pool of Data buffers for efficient memory reuse.
final class BufferPool {
    /// Default buffer size in bytes (8KB)
    static let defaultBufferSize = 8192
    
    /// Default maximum number of buffers to keep in the pool
    static let defaultMaxPoolSize = 25
    
    private let bufferSize: Int
    private let maxPoolSize: Int
    private var pool: [Data] = []
    private let lock = NSLock()
    private var currentPoolSize = 0
    
    /// Pool statistics for monitoring
    struct Stats {
        let bufferSize: Int
        let maxPoolSize: Int
        let currentPoolSize: Int
        let poolUtilization: Double
    }
    
    /// Creates a new buffer pool with specified buffer size and maximum pool size.
    /// - Parameters:
    ///   - bufferSize: The size of each buffer in bytes
    ///   - maxPoolSize: Maximum number of buffers to keep in the pool
    init(bufferSize: Int = BufferPool.defaultBufferSize, maxPoolSize: Int = BufferPool.defaultMaxPoolSize) {
        self.bufferSize = bufferSize
        self.maxPoolSize = maxPoolSize
    }
    
    /// Creates a pool optimized for small frequent reads (similar to Node.js behavior)
    /// - Returns: A BufferPool configured for small buffer operations
    static func createSmallBufferPool() -> BufferPool {
        return BufferPool(bufferSize: 4096, maxPoolSize: 50)
    }
    
    /// Creates a pool optimized for large file operations
    /// - Returns: A BufferPool configured for large buffer operations
    static func createLargeBufferPool() -> BufferPool {
        return BufferPool(bufferSize: 65536, maxPoolSize: 10)
    }
    
    /// Acquires a buffer from the pool or creates a new one if none are available.
    /// - Parameter requestedSize: The desired buffer size. If larger than bufferSize, a new buffer will be created.
    /// - Returns: A Data buffer of at least the requested size
    func acquire(requestedSize: Int? = nil) -> Data {
        let size = requestedSize ?? bufferSize
        if size > bufferSize {
            return Data(count: size)
        }
        
        lock.lock()
        defer { lock.unlock() }
        
        if let buffer = pool.popLast() {
            currentPoolSize -= 1
            return buffer
        }
        
        return Data(count: bufferSize)
    }
    
    /// Returns a buffer to the pool if there's room, otherwise lets it be garbage collected.
    /// - Parameter buffer: The buffer to return to the pool
    func release(_ buffer: Data) {
        guard buffer.count == bufferSize else {
            return // Wrong size, let it be garbage collected
        }
        
        lock.lock()
        defer { lock.unlock() }
        
        guard currentPoolSize < maxPoolSize else {
            return // Pool is full, let it be garbage collected
        }
        
        // Reset buffer content for security and consistency
        var cleanBuffer = Data(count: bufferSize)
        cleanBuffer.resetBytes(in: 0..<bufferSize)
        
        pool.append(cleanBuffer)
        currentPoolSize += 1
    }
    
    /// Returns a buffer to the pool, reusing the existing buffer instance (faster but less secure)
    /// - Parameter buffer: The buffer to return to the pool
    /// - Note: Use this only when you're certain the buffer doesn't contain sensitive data
    func releaseUnsafe(_ buffer: Data) {
        guard buffer.count == bufferSize else {
            return // Wrong size, let it be garbage collected
        }
        
        lock.lock()
        defer { lock.unlock() }
        
        guard currentPoolSize < maxPoolSize else {
            return // Pool is full, let it be garbage collected
        }
        
        pool.append(buffer)
        currentPoolSize += 1
    }
    
    /// Clears all buffers from the pool.
    func clear() {
        lock.lock()
        defer { lock.unlock() }
        
        pool.removeAll()
        currentPoolSize = 0
    }
    
    /// Returns the current number of buffers available in the pool.
    /// - Returns: Number of available buffers
    func availableBuffers() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return currentPoolSize
    }
    
    /// Returns pool statistics for monitoring.
    /// - Returns: Current pool statistics
    func getStats() -> Stats {
        lock.lock()
        defer { lock.unlock() }
        
        return Stats(
            bufferSize: bufferSize,
            maxPoolSize: maxPoolSize,
            currentPoolSize: currentPoolSize,
            poolUtilization: Double(currentPoolSize) / Double(maxPoolSize)
        )
    }
}

// MARK: - Usage Examples and Extensions

extension BufferPool {
    /// Convenience method to acquire a buffer, use it in a closure, and automatically release it
    /// - Parameter requestedSize: The desired buffer size
    /// - Parameter block: Closure that uses the buffer
    /// - Returns: The result of the block execution
    /// - Throws: Any error thrown by the block
    func withBuffer<T>(requestedSize: Int? = nil, _ block: (inout Data) throws -> T) rethrows -> T {
        var buffer = acquire(requestedSize: requestedSize)
        defer { release(buffer) }
        return try block(&buffer)
    }
    
    /// Convenience method for unsafe buffer usage (no cleaning on release)
    /// - Parameter requestedSize: The desired buffer size
    /// - Parameter block: Closure that uses the buffer
    /// - Returns: The result of the block execution
    /// - Throws: Any error thrown by the block
    func withBufferUnsafe<T>(requestedSize: Int? = nil, _ block: (inout Data) throws -> T) rethrows -> T {
        var buffer = acquire(requestedSize: requestedSize)
        defer { releaseUnsafe(buffer) }
        return try block(&buffer)
    }
}
