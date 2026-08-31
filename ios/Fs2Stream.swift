import Foundation
import NitroModules

class Fs2Stream: HybridFs2StreamSpec {
  // MARK: - State Definitions

  /// Every mutable field on the two state classes below is written from the JS thread
  /// (`pause`, `resume`, `close`, `write`) and read from the background `Task` that drives the
  /// read or write loop. Left unsynchronised that is a data race, which Thread Sanitizer
  /// confirmed on `isPaused` - written by `resumeReadStream`, read by the read loop's
  /// `while`/`if`. A torn `Bool` is not the real hazard on arm64; the compiler hoisting a
  /// non-atomic read out of `while state.isActive { if state.isPaused ... }` is, because that
  /// would make pause stop working entirely under optimisation.
  ///
  /// Each accessor takes the lock for a single field access and releases it immediately. No
  /// critical section spans an `await`, so the background tasks cannot deadlock against the
  /// JS thread.
  private class ReadStreamState {
    let fileHandle: FileHandle
    let options: ReadStreamOptions?

    private let lock = NSLock()
    private var _isActive: Bool = false
    private var _isPaused: Bool = false
    private var _position: Int64 = 0
    private var _task: Task<Void, Never>? = nil
    private var _pauseStreamContinuation: AsyncStream<Void>.Continuation?
    private var _pauseStream: AsyncStream<Void>?

    private func sync<T>(_ body: () -> T) -> T {
      lock.lock()
      defer { lock.unlock() }
      return body()
    }

    var isActive: Bool {
      get { sync { _isActive } }
      set { sync { _isActive = newValue } }
    }
    var isPaused: Bool {
      get { sync { _isPaused } }
      set { sync { _isPaused = newValue } }
    }
    var position: Int64 {
      get { sync { _position } }
      set { sync { _position = newValue } }
    }
    var task: Task<Void, Never>? {
      get { sync { _task } }
      set { sync { _task = newValue } }
    }
    // AsyncStream for pausing/resuming
    var pauseStreamContinuation: AsyncStream<Void>.Continuation? {
      get { sync { _pauseStreamContinuation } }
      set { sync { _pauseStreamContinuation = newValue } }
    }
    var pauseStream: AsyncStream<Void>? {
      get { sync { _pauseStream } }
      set { sync { _pauseStream = newValue } }
    }

    init(fileHandle: FileHandle, options: ReadStreamOptions?) {
      self.fileHandle = fileHandle
      self.options = options
    }
  }

  private class WriteStreamState {
    let fileHandle: FileHandle
    let options: WriteStreamOptions?
    let queue = DispatchQueue(label: "com.margelo.nitro.fs2.writequeue")

    private let lock = NSLock()
    private var _isActive: Bool = false
    private var _position: Int64 = 0
    private var _task: Task<Void, Never>? = nil
    private var _writeBufferContinuation: AsyncStream<(Data, Bool)>.Continuation?
    private var _writeBufferStream: AsyncStream<(Data, Bool)>?
    private var _shouldFlush: Bool = false

    private func sync<T>(_ body: () -> T) -> T {
      lock.lock()
      defer { lock.unlock() }
      return body()
    }

    var isActive: Bool {
      get { sync { _isActive } }
      set { sync { _isActive = newValue } }
    }
    /// Advanced only by the single background writer task, so the read-modify-write at its
    /// call site is safe; the lock is here for the readers (`getWriteStreamPosition` and the
    /// progress events).
    var position: Int64 {
      get { sync { _position } }
      set { sync { _position = newValue } }
    }
    var task: Task<Void, Never>? {
      get { sync { _task } }
      set { sync { _task = newValue } }
    }
    // AsyncStream for Swift 6 compatibility
    var writeBufferContinuation: AsyncStream<(Data, Bool)>.Continuation? {
      get { sync { _writeBufferContinuation } }
      set { sync { _writeBufferContinuation = newValue } }
    }
    var writeBufferStream: AsyncStream<(Data, Bool)>? {
      get { sync { _writeBufferStream } }
      set { sync { _writeBufferStream = newValue } }
    }
    var shouldFlush: Bool {
      get { sync { _shouldFlush } }
      set { sync { _shouldFlush = newValue } }
    }

    init(fileHandle: FileHandle, options: WriteStreamOptions?) {
      self.fileHandle = fileHandle
      self.options = options
    }
  }

  // MARK: - State Maps

  /// Guards every dictionary below.
  ///
  /// The registries are written from the JS thread (`listenTo*`, `createReadStream`,
  /// `close*`) and read from the background `Task`s that drive the read and write loops.
  /// A Swift `Dictionary` is not safe under concurrent access - it can corrupt its storage,
  /// not merely return a stale value. `BufferPool` in this module already guards its state
  /// the same way; the maps were simply missed. Android has always used `ConcurrentHashMap`.
  ///
  /// Listener closures are looked up *under* the lock and invoked *outside* it - see
  /// `listener(_:)`. Never `await` inside `withRegistry`: `NSLock` is not reentrant and is
  /// not tied to a task.
  private let registryLock = NSLock()

  private var readStreams: [String: ReadStreamState] = [:]
  private var writeStreams: [String: WriteStreamState] = [:]

  // MARK: - Buffer Pool

  private let bufferPool = BufferPool()

  // MARK: - Event Listener Maps

  private var readStreamDataListeners: [String: (ReadStreamDataEvent) -> Void] = [:]
  private var readStreamProgressListeners: [String: (ReadStreamProgressEvent) -> Void] = [:]
  private var readStreamEndListeners: [String: (ReadStreamEndEvent) -> Void] = [:]
  private var readStreamErrorListeners: [String: (ReadStreamErrorEvent) -> Void] = [:]
  private var writeStreamProgressListeners: [String: (WriteStreamProgressEvent) -> Void] = [:]
  private var writeStreamFinishListeners: [String: (WriteStreamFinishEvent) -> Void] = [:]
  private var writeStreamErrorListeners: [String: (WriteStreamErrorEvent) -> Void] = [:]

  // MARK: - Registry Access

  /// Runs `body` while holding `registryLock`. Must not contain an `await`.
  @discardableResult
  private func withRegistry<T>(_ body: () -> T) -> T {
    registryLock.lock()
    defer { registryLock.unlock() }
    return body()
  }

  // MARK: - Read Stream Methods

  func createReadStream(path: String, options: ReadStreamOptions?) throws -> NitroModules.Promise<ReadStreamHandle> {
    return Promise.async {
      let fileURL = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw StreamError.notFound(path: path)
      }
      guard let fileHandle = try? FileHandle(forReadingFrom: fileURL) else {
        throw StreamError.accessDenied(path: path)
      }
      let streamId = UUID().uuidString
      let state = ReadStreamState(fileHandle: fileHandle, options: options)
      self.withRegistry { self.readStreams[streamId] = state }
      return ReadStreamHandle(streamId: streamId)
    }
  }

  func createWriteStream(path: String, options: WriteStreamOptions?) throws -> NitroModules.Promise<WriteStreamHandle> {
    return Promise.async {
      let fileURL = URL(fileURLWithPath: path)
      if options?.createDirectories == true {
        let parent = fileURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
      }

      let append = options?.append ?? false
      if !FileManager.default.fileExists(atPath: fileURL.path) {
        FileManager.default.createFile(atPath: fileURL.path, contents: nil)
      }

      guard let fileHandle = try? FileHandle(forWritingTo: fileURL) else {
        throw StreamError.accessDenied(path: path)
      }

      if append {
        try? fileHandle.seekToEnd()
      } else {
        try? fileHandle.truncate(atOffset: 0)
      }

      let streamId = UUID().uuidString
      let state = WriteStreamState(fileHandle: fileHandle, options: options)
      state.isActive = true

      // Setup AsyncStream for write buffer
      let (stream, continuation) = AsyncStream<(Data, Bool)>.makeStream()
      state.writeBufferStream = stream
      state.writeBufferContinuation = continuation
      self.withRegistry { self.writeStreams[streamId] = state }

      // Start background write task
      state.task = Task(priority: .background) { [weak self] in
        guard let self = self, let stream = state.writeBufferStream else {
          return
        }

        do {
          for await (data, _) in stream {
            try state.fileHandle.write(contentsOf: data)

            state.position += Int64(data.count)
            self.withRegistry { self.writeStreamProgressListeners[streamId] }?(WriteStreamProgressEvent(
              streamId: streamId,
              bytesWritten: state.position,
              lastChunkSize: Int64(data.count)
            ))

            if state.shouldFlush {
              try? state.fileHandle.synchronize()
              state.shouldFlush = false
            }

          }
        } catch {
          self.withRegistry { self.writeStreamErrorListeners[streamId] }?(WriteStreamErrorEvent(
            streamId: streamId,
            error: StreamError.ioError(message: error.localizedDescription).errorDescription ?? "Unknown error",
            code: nil
          ))
          state.isActive = false
        }

        // Cleanup: remove from map, sync and close file, emit finish event, cleanup listeners
        self.withRegistry { _ = self.writeStreams.removeValue(forKey: streamId) }
        try? state.fileHandle.synchronize()
        try? state.fileHandle.close()

        self.withRegistry { self.writeStreamFinishListeners[streamId] }?(WriteStreamFinishEvent(
          streamId: streamId,
          bytesWritten: state.position,
          success: true
        ))

        self.withRegistry { _ = self.writeStreamProgressListeners.removeValue(forKey: streamId) }
        self.withRegistry { _ = self.writeStreamFinishListeners.removeValue(forKey: streamId) }
        self.withRegistry { _ = self.writeStreamErrorListeners.removeValue(forKey: streamId) }
      }
      return WriteStreamHandle(streamId: streamId)
    }
  }

  // MARK: - Read Stream Control

  func startReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams[streamId] }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }

      if state.isActive { return }

      state.isActive = true
      state.isPaused = false

      let bufferSize = Int(state.options?.bufferSize ?? Double(BufferPool.defaultBufferSize))
      let start = state.options?.start ?? 0
      let end = state.options?.end
      var position = start
      var chunk: Int64 = 0
      let fileLengthUInt = (try? state.fileHandle.seekToEnd()) ?? 0
      let fileLength = fileLengthUInt > UInt64(Int64.max) ? Int64.max : Int64(fileLengthUInt)
      try? state.fileHandle.seek(toOffset: UInt64(start))
      state.position = start

      // Setup AsyncStream for pausing/resuming
      let (pauseStream, pauseContinuation) = AsyncStream<Void>.makeStream()

      state.pauseStream = pauseStream
      state.pauseStreamContinuation = pauseContinuation
      state.task = Task(priority: .background) { [weak self] in
        guard let self = self else { return }
        var bytesReadTotal: Int64 = 0
        do {
          while state.isActive {
            if state.isPaused, let pauseStream = state.pauseStream {
              for await _ in pauseStream {
                if !state.isPaused { break }
              }
            }

            let bytesToRead: Int
            if let end = end {
              let remaining = end - position + 1
              if remaining <= 0 {
                break
              }
              bytesToRead = min(bufferSize, Int(remaining))
            } else {
              bytesToRead = bufferSize
            }

            // Use buffer pool - read directly into buffer
            var buffer = self.bufferPool.acquire(requestedSize: bytesToRead)
            defer { self.bufferPool.release(buffer) }

            let bytesRead = try buffer.withUnsafeMutableBytes { bufferPtr -> Int in
              guard let baseAddress = bufferPtr.baseAddress else { return 0 }
              let fd = state.fileHandle.fileDescriptor
              let result = Darwin.read(fd, baseAddress, bytesToRead)
              guard result >= 0 else {
                throw StreamError.ioError(message: String(cString: strerror(errno)))
              }
              return result
            }

            if bytesRead == 0 {
              break
            }

            let data = buffer.prefix(bytesRead)
            let arrayBuffer = try ArrayBuffer.copy(data: data)

            self.withRegistry { self.readStreamDataListeners[streamId] }?(ReadStreamDataEvent(
              streamId: streamId,
              data: arrayBuffer,
              chunk: chunk,
              position: position
            ))

            position += Int64(bytesRead)
            state.position = position
            bytesReadTotal += Int64(bytesRead)
            chunk += 1

            self.withRegistry { self.readStreamProgressListeners[streamId] }?(ReadStreamProgressEvent(
              streamId: streamId,
              bytesRead: bytesReadTotal,
              totalBytes: fileLength,
              progress: fileLength > 0 ? Double(bytesReadTotal) / Double(fileLength) : 0
            ))

            if let end = end, position > end {
              break
            }
          }

          self.withRegistry { self.readStreamEndListeners[streamId] }?(ReadStreamEndEvent(
            streamId: streamId,
            bytesRead: bytesReadTotal,
            success: true
          ))
        } catch {
          self.withRegistry { self.readStreamErrorListeners[streamId] }?(ReadStreamErrorEvent(
            streamId: streamId,
            error: StreamError.ioError(message: error.localizedDescription).errorDescription ?? "Unknown error",
            code: nil
          ))
        }

        state.isActive = false
        state.task = nil

        // Only cleanup if stream wasn't already removed by closeReadStream
        if self.withRegistry({ self.readStreams.removeValue(forKey: streamId) }) != nil {
          try? state.fileHandle.close()
          self.withRegistry { _ = self.readStreamDataListeners.removeValue(forKey: streamId) }
          self.withRegistry { _ = self.readStreamProgressListeners.removeValue(forKey: streamId) }
          self.withRegistry { _ = self.readStreamEndListeners.removeValue(forKey: streamId) }
          self.withRegistry { _ = self.readStreamErrorListeners.removeValue(forKey: streamId) }
        }
      }
    }
  }

  func pauseReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams[streamId] }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }
      if !state.isActive { return }

      // Setting the flag is the whole operation. This used to also finish the continuation and
      // install a fresh AsyncStream, which broke both directions of the handshake: the read
      // loop could capture the stream that had just been finished - `for await` over a finished
      // stream returns immediately, so the pause silently became a no-op - and a later
      // `resume()` could yield into a continuation nobody was awaiting, losing the wakeup and
      // hanging the reader. One stream per read stream, created in `startReadStream` and
      // finished in `closeReadStream`, keeps both ends talking to the same object.
      state.isPaused = true
    }
  }

  func resumeReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams[streamId] }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }

      // Only resume if stream is paused
      if !state.isPaused { return }

      // Validate that stream has been started and has a pause continuation
      guard state.task != nil, state.pauseStreamContinuation != nil else {
        throw StreamError.ioError(message: "Cannot resume: stream not started or not properly paused")
      }

      // Resume by yielding to the pauseStream
      state.isPaused = false
      state.pauseStreamContinuation?.yield(())
      state.isActive = true
    }
  }

  func closeReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams.removeValue(forKey: streamId) }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }

      // Cancel and wait for task to finish before closing file handle
      state.isActive = false
      // Unblocks a reader parked in the pause handshake. Task cancellation alone would
      // usually end the `for await`, but finishing the stream makes it deterministic.
      state.isPaused = false
      state.pauseStreamContinuation?.finish()
      state.task?.cancel()
      if let task = state.task {
        _ = await task.result
      }

      try? state.fileHandle.close()

      // Cleanup listeners (task's finally block will skip this since stream was removed)
      self.withRegistry { _ = self.readStreamDataListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.readStreamProgressListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.readStreamEndListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.readStreamErrorListeners.removeValue(forKey: streamId) }
    }
  }

  func isReadStreamActive(streamId: String) throws -> NitroModules.Promise<Bool> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams[streamId] }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }
      return state.isActive
    }
  }

  // MARK: - Write Stream Control

  func writeToStream(streamId: String, data: NitroModules.ArrayBuffer) throws -> NitroModules.Promise<Void> {
    // Buffers arriving from JS are non-owning and unsafe past this synchronous
    // call; ones that already own their memory need no copy at all.
    let copiedBuffer = data.asOwning()

    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      if !state.isActive { throw RuntimeError.error(withMessage: "EPIPE: Write stream is not active: \(streamId)") }

      // Check if task is cancelled BEFORE yielding data to prevent data loss
      if let task = state.task, task.isCancelled {
        throw RuntimeError.error(withMessage: "EPIPE: Write job is not active")
      }

      let data = copiedBuffer.toData(copyIfNeeded: true)
      state.writeBufferContinuation?.yield((data, false))
    }
  }

  func flushWriteStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      state.shouldFlush = true
    }
  }

  func closeWriteStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams.removeValue(forKey: streamId) }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      // `writeToStream` only enqueues - it resolves as soon as the chunk is accepted, not
      // when it reaches the file. Cancelling the writer here therefore discarded every chunk
      // still buffered, silently truncating the destination: a caller whose writes had all
      // resolved still got a short file. Finish the queue and await the drain, exactly as
      // `endWriteStream` already did.
      state.writeBufferContinuation?.finish()
      if let task = state.task {
        _ = await task.result
      }
      try? state.fileHandle.close()

      // After the await, so the writer's finish event has already been delivered. Removing
      // the listeners first would have dropped it.
      self.withRegistry { _ = self.writeStreamProgressListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.writeStreamFinishListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.writeStreamErrorListeners.removeValue(forKey: streamId) }
    }
  }

  func isWriteStreamActive(streamId: String) throws -> NitroModules.Promise<Bool> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }
      return state.isActive
    }
  }

  func getWriteStreamPosition(streamId: String) throws -> NitroModules.Promise<Int64> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }
      return state.position
    }
  }

  func endWriteStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      // Mark the stream as finished (no more writes)
      state.writeBufferContinuation?.finish()

      // Wait for the background write task to finish
      if let task = state.task {
        _ = await task.result
      }
    }
  }

  // MARK: - Event Listener Registration

  func listenToReadStreamData(streamId: String, onData: @escaping (ReadStreamDataEvent) -> Void) throws -> () -> Void {
    withRegistry { self.readStreamDataListeners[streamId] = onData }
    return { [weak self] in self?.withRegistry { _ = self?.readStreamDataListeners.removeValue(forKey: streamId) } }
  }

  func listenToReadStreamProgress(streamId: String, onProgress: @escaping (ReadStreamProgressEvent) -> Void) throws -> () -> Void {
    withRegistry { self.readStreamProgressListeners[streamId] = onProgress }
    return { [weak self] in self?.withRegistry { _ = self?.readStreamProgressListeners.removeValue(forKey: streamId) } }
  }

  func listenToReadStreamEnd(streamId: String, onEnd: @escaping (ReadStreamEndEvent) -> Void) throws -> () -> Void {
    withRegistry { self.readStreamEndListeners[streamId] = onEnd }
    return { [weak self] in self?.withRegistry { _ = self?.readStreamEndListeners.removeValue(forKey: streamId) } }
  }

  func listenToReadStreamError(streamId: String, onError: @escaping (ReadStreamErrorEvent) -> Void) throws -> () -> Void {
    withRegistry { self.readStreamErrorListeners[streamId] = onError }
    return { [weak self] in self?.withRegistry { _ = self?.readStreamErrorListeners.removeValue(forKey: streamId) } }
  }

  func listenToWriteStreamProgress(streamId: String, onProgress: @escaping (WriteStreamProgressEvent) -> Void) throws -> () -> Void {
    withRegistry { self.writeStreamProgressListeners[streamId] = onProgress }
    return { [weak self] in self?.withRegistry { _ = self?.writeStreamProgressListeners.removeValue(forKey: streamId) } }
  }

  func listenToWriteStreamFinish(streamId: String, onFinish: @escaping (WriteStreamFinishEvent) -> Void) throws -> () -> Void {
    withRegistry { self.writeStreamFinishListeners[streamId] = onFinish }
    return { [weak self] in self?.withRegistry { _ = self?.writeStreamFinishListeners.removeValue(forKey: streamId) } }
  }

  func listenToWriteStreamError(streamId: String, onError: @escaping (WriteStreamErrorEvent) -> Void) throws -> () -> Void {
    withRegistry { self.writeStreamErrorListeners[streamId] = onError }
    return { [weak self] in self?.withRegistry { _ = self?.writeStreamErrorListeners.removeValue(forKey: streamId) } }
  }
}
