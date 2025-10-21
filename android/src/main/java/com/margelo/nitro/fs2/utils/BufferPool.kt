package com.margelo.nitro.fs2.utils

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * A thread-safe pool of byte arrays for efficient memory reuse.
 * @param bufferSize The size of each buffer in the pool
 * @param maxPoolSize The maximum number of buffers to keep in the pool
 */
class BufferPool(
    private val bufferSize: Int = DEFAULT_BUFFER_SIZE,
    private val maxPoolSize: Int = DEFAULT_MAX_POOL_SIZE
) {
    private val pool = ConcurrentLinkedQueue<ByteArray>()
    private val currentPoolSize = AtomicInteger(0)

    /**
     * Acquires a buffer from the pool or creates a new one if none are available.
     * @param requestedSize The desired buffer size. If larger than bufferSize, a new buffer will be created.
     * @return A byte array of at least the requested size
     */
    fun acquire(requestedSize: Int = bufferSize): ByteArray {
        if (requestedSize > bufferSize) {
            return ByteArray(requestedSize)
        }
        
        val pooledBuffer = pool.poll()
        return if (pooledBuffer != null) {
            currentPoolSize.decrementAndGet()
            pooledBuffer
        } else {
            ByteArray(bufferSize)
        }
    }

    /**
     * Returns a buffer to the pool if there's room, otherwise lets it be garbage collected.
     * @param buffer The buffer to return to the pool
     */
    fun release(buffer: ByteArray) {
        if (buffer.size != bufferSize) {
            return // Wrong size, let it be garbage collected
        }
        
        // Only add to pool if we haven't exceeded the limit
        if (currentPoolSize.get() < maxPoolSize && pool.offer(buffer)) {
            currentPoolSize.incrementAndGet()
        }
        // If pool.offer() fails or we're at capacity, let buffer be GC'd
    }

    /**
     * Clears all buffers from the pool.
     */
    fun clear() {
        pool.clear()
        currentPoolSize.set(0)
    }

    /**
     * Returns the current number of buffers available in the pool.
     */
    fun availableBuffers(): Int = currentPoolSize.get()

    /**
     * Returns pool statistics for monitoring.
     */
    fun getStats(): PoolStats = PoolStats(
        bufferSize = bufferSize,
        maxPoolSize = maxPoolSize,
        currentPoolSize = currentPoolSize.get(),
        poolUtilization = currentPoolSize.get().toDouble() / maxPoolSize
    )

    data class PoolStats(
        val bufferSize: Int,
        val maxPoolSize: Int,
        val currentPoolSize: Int,
        val poolUtilization: Double
    )

    companion object {
        const val DEFAULT_BUFFER_SIZE = 8192 // 8KB
        const val DEFAULT_MAX_POOL_SIZE = 25
        
        /**
         * Creates a pool optimized for small frequent reads (similar to Node.js behavior)
         */
        fun createSmallBufferPool(): BufferPool = BufferPool(4096, 50)
        
        /**
         * Creates a pool optimized for large file operations
         */
        fun createLargeBufferPool(): BufferPool = BufferPool(65536, 10)
    }
}