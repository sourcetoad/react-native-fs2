import Foundation
import NitroModules

class Fs2Stream: HybridFs2StreamSpec {
  /// Mirrors MAX_STREAM_BUFFER_SIZE in src/_filestream.ts.
  static let maxBufferSize = 16 * 1024 * 1024

  /// Mirrors DEFAULT_STREAM_BUFFER_SIZE in src/_filestream.ts, so a handle created without
  /// options reads in the same chunks the high-level helpers ask for.
  static let defaultBufferSize = 64 * 1024

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
    /// Opened in `startReadStream`, not at create: a stream that is created and never started
    /// would otherwise hold a descriptor for the life of the process.
    let fileURL: URL
    let options: ReadStreamOptions?

    private let lock = NSLock()
    private var _isActive: Bool = false
    private var _isPaused: Bool = false
    private var _position: Int64 = 0
    private var _task: Task<Void, Never>? = nil
    private var _pauseStreamContinuation: AsyncStream<Void>.Continuation?
    private var _pauseStream: AsyncStream<Void>?
    private var _fileHandle: FileHandle?
    private var _closedByCaller: Bool = false
    private var _ackContinuation: AsyncStream<Error?>.Continuation?

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

    var fileHandle: FileHandle? {
      get { sync { _fileHandle } }
      set { sync { _fileHandle = newValue } }
    }
    /// Atomic test-and-set. Two concurrent `start()` calls both passing an
    /// `if isActive` check would launch two read loops over one descriptor, so every
    /// reported position would be wrong and only the second task would be cancellable.
    func tryActivate() -> Bool {
      sync {
        if _isActive { return false }
        _isActive = true
        _isPaused = false
        return true
      }
    }

    /// Distinguishes "reached EOF" from "the caller closed us" on the end event.
    var closedByCaller: Bool {
      get { sync { _closedByCaller } }
      set { sync { _closedByCaller = newValue } }
    }
    /// Set while the read loop is waiting for the JS consumer. `closeReadStream` finishes it
    /// to release a loop whose consumer never answers.
    var ackContinuation: AsyncStream<Error?>.Continuation? {
      get { sync { _ackContinuation } }
      set { sync { _ackContinuation = newValue } }
    }

    init(fileURL: URL, options: ReadStreamOptions?) {
      self.fileURL = fileURL
      self.options = options
    }
  }

  /// One item in a write stream's queue.
  ///
  /// `data == nil` is a flush marker. Routing flush through the queue rather than setting a
  /// flag is what makes `await flush()` mean anything: the flag it replaced was only consulted
  /// *after the next chunk*, so a flush with no write behind it never synced at all, and the
  /// promise resolved either way.
  private struct WriteCommand {
    let data: Data?
    let completion: CheckedContinuation<Void, Error>?
  }

  private class WriteStreamState {
    let fileHandle: FileHandle
    let options: WriteStreamOptions?
    let queue = DispatchQueue(label: "com.margelo.nitro.fs2.writequeue")
    /// Bytes allowed to sit in the write queue at once - `WriteStreamOptions.bufferSize`.
    let capacity: Int

    private let lock = NSLock()
    private var _isActive: Bool = false
    private var _position: Int64 = 0
    private var _task: Task<Void, Never>? = nil
    private var _writeBufferContinuation: AsyncStream<WriteCommand>.Continuation?
    private var _writeBufferStream: AsyncStream<WriteCommand>?
    private var _pendingBytes: Int = 0
    private var _spaceWaiters: [(bytes: Int, continuation: CheckedContinuation<Void, Never>)] = []
    private var _budgetClosed: Bool = false

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
    var writeBufferContinuation: AsyncStream<WriteCommand>.Continuation? {
      get { sync { _writeBufferContinuation } }
      set { sync { _writeBufferContinuation = newValue } }
    }
    var writeBufferStream: AsyncStream<WriteCommand>? {
      get { sync { _writeBufferStream } }
      set { sync { _writeBufferStream = newValue } }
    }

    /// Suspends until `bytes` fit within `capacity`, then charges them to the queue.
    ///
    /// This is what makes `writeToStream`'s promise a real back-pressure signal. It used to
    /// resolve the moment the chunk was accepted into an unbounded `AsyncStream`, so a
    /// producer faster than the disk grew native memory without limit while every `await`
    /// returned immediately.
    ///
    /// A chunk larger than the whole budget is admitted on its own rather than waiting for
    /// room that can never appear.
    func reserve(_ bytes: Int) async {
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        lock.lock()
        let fits = _pendingBytes == 0 || _pendingBytes + bytes <= capacity
        if _budgetClosed || (_spaceWaiters.isEmpty && fits) {
          _pendingBytes += bytes
          lock.unlock()
          continuation.resume()
          return
        }
        _spaceWaiters.append((bytes, continuation))
        lock.unlock()
      }
    }

    /// Returns `bytes` to the budget and admits whoever now fits, in arrival order.
    func release(_ bytes: Int) {
      lock.lock()
      _pendingBytes -= bytes
      var admitted: [CheckedContinuation<Void, Never>] = []
      while let next = _spaceWaiters.first,
            _pendingBytes == 0 || _pendingBytes + next.bytes <= capacity {
        _spaceWaiters.removeFirst()
        _pendingBytes += next.bytes
        admitted.append(next.continuation)
      }
      lock.unlock()
      for continuation in admitted { continuation.resume() }
    }

    /// Admits everyone still waiting. Nothing will drain the queue after this, so a waiter
    /// left parked would be a `write()` that never settles; each one then fails on the
    /// finished continuation instead.
    func closeBudget() {
      lock.lock()
      _budgetClosed = true
      let waiting = _spaceWaiters
      _spaceWaiters.removeAll()
      for waiter in waiting { _pendingBytes += waiter.bytes }
      lock.unlock()
      for waiter in waiting { waiter.continuation.resume() }
    }

    init(fileHandle: FileHandle, options: WriteStreamOptions?, capacity: Int) {
      self.fileHandle = fileHandle
      self.options = options
      self.capacity = capacity
    }
  }

  // MARK: - State Maps

  /// Guards every dictionary below.
  ///
  /// The registries are written from the JS thread (`listenTo*`, `createReadStream`,
  /// `close*`) and read from the background `Task`s that drive the read and write loops.
  /// A Swift `Dictionary` is not safe under concurrent access - it can corrupt its storage,
  /// not merely return a stale value. Android has always used `ConcurrentHashMap`.
  ///
  /// Listener closures are looked up *under* the lock and invoked *outside* it - see
  /// `listener(_:)`. Never `await` inside `withRegistry`: `NSLock` is not reentrant and is
  /// not tied to a task.
  private let registryLock = NSLock()

  private var readStreams: [String: ReadStreamState] = [:]
  private var writeStreams: [String: WriteStreamState] = [:]

  // MARK: - Event Listener Maps

  private var readStreamDataListeners: [String: (ReadStreamDataEvent) -> Promise<Promise<Bool>>] = [:]
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

  // MARK: - Chunk Delivery

  /// Hands `event` to the JS consumer and waits for it to finish with the chunk.
  ///
  /// The JS callback is declared as returning `Promise<boolean>`, which Nitro delivers here as
  /// a `Promise<Promise<Bool>>`: the outer one resolves once the callback has run on the JS
  /// thread, the inner one once the promise it returned settles. The value is ignored - see
  /// `Fs2Stream.nitro.ts` for why it is not `void`. Awaiting both is the whole of
  /// the read path's back-pressure. Without it the loop reads at disk speed while every chunk
  /// piles up as an owning copy in the dispatcher's unbounded queue, so peak memory tracks the
  /// file size rather than the buffer size.
  ///
  /// Returns `false` if `closeReadStream` released the loop before JS answered. `Promise.await()`
  /// is built on a non-cancellable continuation, so a consumer that never settles would
  /// otherwise park the loop on an open descriptor for the life of the process.
  private func deliver(
    _ event: ReadStreamDataEvent,
    to listener: (ReadStreamDataEvent) -> Promise<Promise<Bool>>,
    state: ReadStreamState
  ) async throws -> Bool {
    let (acks, ackContinuation) = AsyncStream<Error?>.makeStream()
    state.ackContinuation = ackContinuation
    // `closeReadStream` may have run between the loop's `while` check and this assignment, in
    // which case it finished the previous continuation and nothing will ever finish this one.
    guard state.isActive else {
      state.ackContinuation = nil
      return false
    }

    let settle: (Error?) -> Void = { error in
      ackContinuation.yield(error)
      ackContinuation.finish()
    }

    listener(event)
      .then({ inner in
        inner
          .then({ _ in settle(nil) })
          .catch({ error in settle(error) })
      })
      .catch({ error in settle(error) })

    var iterator = acks.makeAsyncIterator()
    let outcome = await iterator.next()
    state.ackContinuation = nil

    guard let outcome = outcome else { return false }
    if let error = outcome { throw error }
    return true
  }

  // MARK: - Read Stream Methods

  func createReadStream(path: String, options: ReadStreamOptions?) throws -> Promise<ReadStreamHandle> {
    return Promise.async {
      let fileURL = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw StreamError.notFound(path: path)
      }
      guard FileManager.default.isReadableFile(atPath: fileURL.path) else {
        throw StreamError.accessDenied(path: path)
      }
      let streamId = UUID().uuidString
      let state = ReadStreamState(fileURL: fileURL, options: options)
      self.withRegistry { self.readStreams[streamId] = state }
      return ReadStreamHandle(streamId: streamId)
    }
  }

  func createWriteStream(path: String, options: WriteStreamOptions?) throws -> Promise<WriteStreamHandle> {
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

      let requestedCapacity = options?.bufferSize ?? Double(Self.defaultBufferSize)
      guard requestedCapacity.isFinite,
            requestedCapacity >= 1,
            requestedCapacity <= Double(Self.maxBufferSize),
            let capacity = Int(exactly: requestedCapacity.rounded(.down)) else {
        try? fileHandle.close()
        throw StreamError.invalidArgument(
          message: "bufferSize must be between 1 and \(Self.maxBufferSize), got \(requestedCapacity)")
      }

      let streamId = UUID().uuidString
      let state = WriteStreamState(fileHandle: fileHandle, options: options, capacity: capacity)
      state.isActive = true

      // Setup AsyncStream for write buffer
      let (stream, continuation) = AsyncStream<WriteCommand>.makeStream()
      state.writeBufferStream = stream
      state.writeBufferContinuation = continuation
      self.withRegistry { self.writeStreams[streamId] = state }

      // Start background write task
      state.task = Task(priority: .background) { [weak self] in
        guard let self = self, let stream = state.writeBufferStream else {
          return
        }

        var hadError = false

        do {
          for await command in stream {
            guard let data = command.data else {
              // Flush marker: everything queued ahead of it has been written by now.
              do {
                try state.fileHandle.synchronize()
                command.completion?.resume()
              } catch {
                command.completion?.resume(throwing: error)
              }
              continue
            }

            defer { state.release(data.count) }
            do {
              try state.fileHandle.write(contentsOf: data)
            } catch {
              command.completion?.resume(throwing: error)
              throw error
            }
            command.completion?.resume()

            state.position += Int64(data.count)
            self.withRegistry { self.writeStreamProgressListeners[streamId] }?(WriteStreamProgressEvent(
              streamId: streamId,
              bytesWritten: state.position,
              lastChunkSize: Int64(data.count)
            ))
          }
        } catch {
          hadError = true
          self.withRegistry { self.writeStreamErrorListeners[streamId] }?(WriteStreamErrorEvent(
            streamId: streamId,
            error: StreamError.ioError(message: error.localizedDescription).errorDescription ?? "Unknown error",
            code: nil
          ))
          state.isActive = false
          state.writeBufferContinuation?.finish() // nothing will drain the queue now
        }

        // Nothing will drain the queue from here on, so anyone still waiting for room has to
        // be let go - they fail on the finished continuation rather than hanging.
        state.closeBudget()

        // Cleanup: remove from map, sync and close file, emit finish event, cleanup listeners
        self.withRegistry { _ = self.writeStreams.removeValue(forKey: streamId) }
        try? state.fileHandle.synchronize()
        try? state.fileHandle.close()

        self.withRegistry { self.writeStreamFinishListeners[streamId] }?(WriteStreamFinishEvent(
          streamId: streamId,
          bytesWritten: state.position,
          success: !hadError
        ))

        self.withRegistry { _ = self.writeStreamProgressListeners.removeValue(forKey: streamId) }
        self.withRegistry { _ = self.writeStreamFinishListeners.removeValue(forKey: streamId) }
        self.withRegistry { _ = self.writeStreamErrorListeners.removeValue(forKey: streamId) }
      }
      return WriteStreamHandle(streamId: streamId)
    }
  }

  // MARK: - Read Stream Control

  func startReadStream(streamId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams[streamId] }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }

      // Before any conversion: `Int(_: Double)` traps, and `UInt64(start)` traps on negatives.
      let requestedBufferSize = state.options?.bufferSize ?? Double(Self.defaultBufferSize)
      guard requestedBufferSize.isFinite,
            requestedBufferSize >= 1,
            requestedBufferSize <= Double(Self.maxBufferSize),
            let bufferSize = Int(exactly: requestedBufferSize.rounded(.down)) else {
        throw StreamError.invalidArgument(
          message: "bufferSize must be between 1 and \(Self.maxBufferSize), got \(requestedBufferSize)")
      }

      let start = state.options?.start ?? 0
      let end = state.options?.end
      guard start >= 0 else {
        throw StreamError.invalidArgument(message: "start must be non-negative, got \(start)")
      }
      if let end = end, end < start {
        throw StreamError.invalidArgument(
          message: "end (\(end)) must not be before start (\(start))")
      }

      // Claim the stream before opening, so a losing racer neither leaks a descriptor nor
      // launches a second loop.
      guard state.tryActivate() else { return }

      guard let fileHandle = try? FileHandle(forReadingFrom: state.fileURL) else {
        state.isActive = false
        // Reporting EACCES for an exhausted descriptor table sends anyone debugging a stream
        // leak looking at file permissions instead.
        if errno == EMFILE || errno == ENFILE {
          throw StreamError.ioError(
            message: "EMFILE: Too many open files - a stream was likely never closed")
        }
        throw StreamError.accessDenied(path: state.fileURL.path)
      }
      state.fileHandle = fileHandle
      var position = start
      var chunk: Int64 = 0
      let fileLengthUInt = (try? fileHandle.seekToEnd()) ?? 0
      let fileLength = fileLengthUInt > UInt64(Int64.max) ? Int64.max : Int64(fileLengthUInt)
      // Progress is reported against the range actually being read. Using the whole file meant
      // a stream with `start` set could never reach 1.0.
      let lastByte = min(end ?? (fileLength - 1), fileLength - 1)
      let rangeTotal = max(0, lastByte - start + 1)
      try? fileHandle.seek(toOffset: UInt64(start))
      state.position = start

      // Setup AsyncStream for pausing/resuming
      let (pauseStream, pauseContinuation) = AsyncStream<Void>.makeStream()

      state.pauseStream = pauseStream
      state.pauseStreamContinuation = pauseContinuation
      state.task = Task(priority: .background) { [weak self] in
        guard let self = self else { return }
        var bytesReadTotal: Int64 = 0
        // One buffer for the whole stream, sized exactly. The pool this replaced bucketed at
        // 8 KB, so every default-configured stream missed it on `acquire` and was rejected on
        // `release`, and each "recycle" allocated and zeroed a fresh buffer anyway.
        var buffer = Data(count: bufferSize)
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

            let bytesRead = try buffer.withUnsafeMutableBytes { bufferPtr -> Int in
              guard let baseAddress = bufferPtr.baseAddress else { return 0 }
              let fd = fileHandle.fileDescriptor
              // Clamp to the buffer we got, not the size we asked for.
              let result = Darwin.read(fd, baseAddress, min(bytesToRead, bufferPtr.count))
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

            if let listener = self.withRegistry({ self.readStreamDataListeners[streamId] }) {
              let event = ReadStreamDataEvent(
                streamId: streamId,
                data: arrayBuffer,
                chunk: chunk,
                position: position
              )
              guard try await self.deliver(event, to: listener, state: state) else {
                break
              }
            }

            position += Int64(bytesRead)
            state.position = position
            bytesReadTotal += Int64(bytesRead)
            chunk += 1

            self.withRegistry { self.readStreamProgressListeners[streamId] }?(ReadStreamProgressEvent(
              streamId: streamId,
              bytesRead: bytesReadTotal,
              totalBytes: rangeTotal,
              progress: rangeTotal > 0 ? Double(bytesReadTotal) / Double(rangeTotal) : 0
            ))

            if let end = end, position > end {
              break
            }
          }

          self.withRegistry { self.readStreamEndListeners[streamId] }?(ReadStreamEndEvent(
            streamId: streamId,
            bytesRead: bytesReadTotal,
            success: !state.closedByCaller
          ))
        } catch {
          if self.withRegistry({ self.readStreamErrorListeners[streamId] }) == nil {
            // Node throws on an unhandled 'error'. Throwing here would take the app down from a
            // background task, so it is logged instead - silently dropping it is the one thing
            // that must not happen.
            NSLog("[RNFS2] Read stream %@ failed with no error listener attached: %@",
                  streamId, error.localizedDescription)
          }
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
          try? state.fileHandle?.close()
          self.withRegistry { _ = self.readStreamDataListeners.removeValue(forKey: streamId) }
          self.withRegistry { _ = self.readStreamProgressListeners.removeValue(forKey: streamId) }
          self.withRegistry { _ = self.readStreamEndListeners.removeValue(forKey: streamId) }
          self.withRegistry { _ = self.readStreamErrorListeners.removeValue(forKey: streamId) }
        }
      }
    }
  }

  func pauseReadStream(streamId: String) throws -> Promise<Void> {
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

  func resumeReadStream(streamId: String) throws -> Promise<Void> {
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

  func closeReadStream(streamId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams.removeValue(forKey: streamId) }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }

      // Cancel and wait for task to finish before closing file handle
      state.closedByCaller = true
      state.isActive = false
      // Unblocks a reader parked in the pause handshake. Task cancellation alone would
      // usually end the `for await`, but finishing the stream makes it deterministic.
      state.isPaused = false
      state.pauseStreamContinuation?.finish()
      // Releases a loop waiting on the JS consumer - see `deliver(_:to:state:)`.
      state.ackContinuation?.finish()
      state.task?.cancel()
      if let task = state.task {
        _ = await task.result
      }

      try? state.fileHandle?.close()

      // Cleanup listeners (task's finally block will skip this since stream was removed)
      self.withRegistry { _ = self.readStreamDataListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.readStreamProgressListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.readStreamEndListeners.removeValue(forKey: streamId) }
      self.withRegistry { _ = self.readStreamErrorListeners.removeValue(forKey: streamId) }
    }
  }

  func isReadStreamActive(streamId: String) throws -> Promise<Bool> {
    return Promise.async {
      guard let state = self.withRegistry({ self.readStreams[streamId] }) else {
        throw StreamError.invalidStream(streamId: streamId)
      }
      return state.isActive
    }
  }

  // MARK: - Write Stream Control

  func writeToStream(streamId: String, data: ArrayBuffer) throws -> Promise<Void> {
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

      // Suspends while the queue is full: this promise resolving is the caller's signal that
      // there is room, which is what `bufferSize` now bounds.
      await state.reserve(data.count)

      guard state.isActive,
            let yielded = state.writeBufferContinuation?.yield(
              WriteCommand(data: data, completion: nil)),
            case .enqueued = yielded else {
        state.release(data.count)
        throw RuntimeError.error(withMessage: "EPIPE: Write stream is not active: \(streamId)")
      }
    }
  }

  func flushWriteStream(streamId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        guard state.isActive,
              let yielded = state.writeBufferContinuation?.yield(
                WriteCommand(data: nil, completion: continuation)),
              case .enqueued = yielded else {
          continuation.resume(throwing:
            RuntimeError.error(withMessage: "EPIPE: Write stream is not active: \(streamId)"))
          return
        }
      }
    }
  }

  func closeWriteStream(streamId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams.removeValue(forKey: streamId) }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      // `writeToStream` only enqueues - it resolves as soon as the chunk is accepted, not
      // when it reaches the file. Cancelling the writer here therefore discarded every chunk
      // still buffered, silently truncating the destination: a caller whose writes had all
      // resolved still got a short file. Finish the queue and await the drain, exactly as
      // `endWriteStream` already did.
      state.isActive = false
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

  func isWriteStreamActive(streamId: String) throws -> Promise<Bool> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }
      return state.isActive
    }
  }

  func getWriteStreamPosition(streamId: String) throws -> Promise<Int64> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }
      return state.position
    }
  }

  func endWriteStream(streamId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let state = self.withRegistry({ self.writeStreams[streamId] }) else {
        throw RuntimeError.error(withMessage: "ENOENT: No such write stream: \(streamId)")
      }

      // Before finishing: a write racing the drain would otherwise yield into a finished
      // continuation, which silently discards it.
      state.isActive = false
      state.writeBufferContinuation?.finish()

      // Wait for the background write task to finish
      if let task = state.task {
        _ = await task.result
      }
    }
  }

  // MARK: - Event Listener Registration

  func listenToReadStreamData(streamId: String, onData: @escaping (ReadStreamDataEvent) -> Promise<Promise<Bool>>) throws -> () -> Void {
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
