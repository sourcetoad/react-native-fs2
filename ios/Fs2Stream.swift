import Foundation
import NitroModules

class Fs2Stream: HybridFs2StreamSpec {
  // MARK: - State Definitions

  private class ReadStreamState {
    let fileHandle: FileHandle
    let options: ReadStreamOptions?
    var isActive: Bool = false
    var position: Int64 = 0
    var task: Task<Void, Never>? = nil
    // AsyncStream for pausing/resuming
    var pauseStreamContinuation: AsyncStream<Void>.Continuation?
    var pauseStream: AsyncStream<Void>?
    init(fileHandle: FileHandle, options: ReadStreamOptions?) {
      self.fileHandle = fileHandle
      self.options = options
    }
  }

  private class WriteStreamState {
    let fileHandle: FileHandle
    let options: WriteStreamOptions?
    var isActive: Bool = false
    var position: Int64 = 0
    var task: Task<Void, Never>? = nil
    let queue = DispatchQueue(label: "com.margelo.nitro.fs2.writequeue")
    // AsyncStream for Swift 6 compatibility
    var writeBufferContinuation: AsyncStream<(Data, Bool)>.Continuation?
    var writeBufferStream: AsyncStream<(Data, Bool)>?
    var shouldFlush: Bool = false
    var shouldClose: Bool = false
    init(fileHandle: FileHandle, options: WriteStreamOptions?) {
      self.fileHandle = fileHandle
      self.options = options
    }
  }

  // MARK: - State Maps

  private var readStreams: [String: ReadStreamState] = [:]
  private var writeStreams: [String: WriteStreamState] = [:]

  // MARK: - Event Listener Maps

  private var readStreamDataListeners: [String: (ReadStreamDataEvent) -> Void] = [:]
  private var readStreamProgressListeners: [String: (ReadStreamProgressEvent) -> Void] = [:]
  private var readStreamEndListeners: [String: (ReadStreamEndEvent) -> Void] = [:]
  private var readStreamErrorListeners: [String: (ReadStreamErrorEvent) -> Void] = [:]
  private var writeStreamProgressListeners: [String: (WriteStreamProgressEvent) -> Void] = [:]
  private var writeStreamFinishListeners: [String: (WriteStreamFinishEvent) -> Void] = [:]
  private var writeStreamErrorListeners: [String: (WriteStreamErrorEvent) -> Void] = [:]

  // MARK: - Read Stream Methods

  func createReadStream(path: String, options: ReadStreamOptions?) throws -> NitroModules.Promise<ReadStreamHandle> {
    return Promise.async {
      let fileURL = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: File does not exist: \(path)"])
      }
      guard let fileHandle = try? FileHandle(forReadingFrom: fileURL) else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "EOPEN: Could not open file: \(path)"])
      }
      let streamId = UUID().uuidString
      let state = ReadStreamState(fileHandle: fileHandle, options: options)
      self.readStreams[streamId] = state
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
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "EOPEN: Could not open file: \(path)"])
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
      self.writeStreams[streamId] = state

      // Start background write task
      state.task = Task(priority: .background) { [weak self, weak state] in
        guard let self = self, let state = state, let stream = state.writeBufferStream else { return }
        do {
          for await (data, _) in stream {
            try state.fileHandle.write(contentsOf: data)
            state.position += Int64(data.count)
            self.writeStreamProgressListeners[streamId]?(WriteStreamProgressEvent(streamId: streamId, bytesWritten: state.position, lastChunkSize: Int64(data.count)))
            if state.shouldFlush {
              try? state.fileHandle.synchronize()
              state.shouldFlush = false
            }
            if state.shouldClose {
              try? state.fileHandle.close()
              state.isActive = false
              break
            }
          }
        } catch {
          self.writeStreamErrorListeners[streamId]?(WriteStreamErrorEvent(streamId: streamId, error: error.localizedDescription, code: nil))
          state.isActive = false
        }
        self.writeStreamFinishListeners[streamId]?(WriteStreamFinishEvent(streamId: streamId, bytesWritten: state.position, success: true))
        self.writeStreams.removeValue(forKey: streamId)
      }
      return WriteStreamHandle(streamId: streamId)
    }
  }

  // MARK: - Read Stream Control

  func startReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.readStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such read stream: \(streamId)"])
      }

      if state.isActive { return }

      state.isActive = true

      let bufferSize = Int(state.options?.bufferSize ?? 8192)
      let start = state.options?.start ?? 0
      let end = state.options?.end
      var position = start
      var chunk: Int64 = 0
      let fileLengthUInt = (try? state.fileHandle.seekToEnd()) ?? 0
      let fileLength = fileLengthUInt > UInt64(Int64.max) ? Int64.max : Int64(fileLengthUInt)
      try? state.fileHandle.seek(toOffset: UInt64(start))
      state.position = start
      state.fileHandle.seek(toFileOffset: UInt64(start))

      // Setup AsyncStream for pausing/resuming
      let (pauseStream, pauseContinuation) = AsyncStream<Void>.makeStream()
      state.pauseStream = pauseStream
      state.pauseStreamContinuation = pauseContinuation
      state.task = Task(priority: .background) { [weak self, weak state] in
        guard let self = self, let state = state else { return }
        var bytesReadTotal: Int64 = 0
        do {
          while state.isActive {
            // Await if paused
            if let pauseStream = state.pauseStream {
              for await _ in pauseStream {
                break // resume when a value is yielded
              }
            }
            let bytesToRead: Int
            if let end = end {
              let remaining = end - position + 1
              if remaining <= 0 { break }
              bytesToRead = min(bufferSize, Int(remaining))
            } else {
              bytesToRead = bufferSize
            }
            let data = try state.fileHandle.read(upToCount: bytesToRead) ?? Data()
            if data.isEmpty { break }
            let arrayBuffer = try ArrayBufferHolder.copy(data: data)
            self.readStreamDataListeners[streamId]?(ReadStreamDataEvent(streamId: streamId, data: arrayBuffer, chunk: chunk, position: position))
            position += Int64(data.count)
            state.position = position
            bytesReadTotal += Int64(data.count)
            chunk += 1
            self.readStreamProgressListeners[streamId]?(ReadStreamProgressEvent(streamId: streamId, bytesRead: bytesReadTotal, totalBytes: fileLength, progress: fileLength > 0 ? Double(bytesReadTotal) / Double(fileLength) : 0))
            if let end = end, position > end { break }
          }
          self.readStreamEndListeners[streamId]?(ReadStreamEndEvent(streamId: streamId, bytesRead: bytesReadTotal, success: true))
        } catch {
          self.readStreamErrorListeners[streamId]?(ReadStreamErrorEvent(streamId: streamId, error: error.localizedDescription, code: nil))
        }
        state.isActive = false
        state.task = nil
        self.readStreams.removeValue(forKey: streamId)
        self.readStreamDataListeners.removeValue(forKey: streamId)
        self.readStreamProgressListeners.removeValue(forKey: streamId)
        self.readStreamEndListeners.removeValue(forKey: streamId)
        self.readStreamErrorListeners.removeValue(forKey: streamId)
      }
    }
  }

  func pauseReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.readStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such read stream: \(streamId)"])
      }
      if !state.isActive { return }
      // Pause by setting up a new pauseStream
      let (pauseStream, pauseContinuation) = AsyncStream<Void>.makeStream()
      state.pauseStream = pauseStream
      state.pauseStreamContinuation = pauseContinuation
      state.isActive = false
    }
  }

  func resumeReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.readStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such read stream: \(streamId)"])
      }
      if state.isActive { return }
      // Resume by yielding to the pauseStream
      state.pauseStreamContinuation?.yield(())
      state.isActive = true
    }
  }

  func closeReadStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.readStreams.removeValue(forKey: streamId) else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such read stream: \(streamId)"])
      }
      state.task?.cancel()
      try? state.fileHandle.close()
      self.readStreamDataListeners.removeValue(forKey: streamId)
      self.readStreamProgressListeners.removeValue(forKey: streamId)
      self.readStreamEndListeners.removeValue(forKey: streamId)
      self.readStreamErrorListeners.removeValue(forKey: streamId)
    }
  }

  func isReadStreamActive(streamId: String) throws -> NitroModules.Promise<Bool> {
    return Promise.async {
      guard let state = self.readStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such read stream: \(streamId)"])
      }
      return state.isActive
    }
  }

  // MARK: - Write Stream Control

  func writeToStream(streamId: String, data: NitroModules.ArrayBufferHolder) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.writeStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such write stream: \(streamId)"])
      }
      if !state.isActive { throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "EPIPE: Write stream is not active: \(streamId)"]) }
      let data = data.toData(copyIfNeeded: true)
      state.writeBufferContinuation?.yield((data, false))
      if let task = state.task, task.isCancelled { throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "EPIPE: Write job is not active"]) }
    }
  }

  func flushWriteStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.writeStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such write stream: \(streamId)"])
      }
      state.shouldFlush = true
    }
  }

  func closeWriteStream(streamId: String) throws -> NitroModules.Promise<Void> {
    return Promise.async {
      guard let state = self.writeStreams.removeValue(forKey: streamId) else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such write stream: \(streamId)"])
      }
      state.shouldClose = true
      state.writeBufferContinuation?.finish()
      state.task?.cancel()
      try? state.fileHandle.close()
      self.writeStreamProgressListeners.removeValue(forKey: streamId)
      self.writeStreamFinishListeners.removeValue(forKey: streamId)
      self.writeStreamErrorListeners.removeValue(forKey: streamId)
      self.writeStreamFinishListeners[streamId]?(WriteStreamFinishEvent(streamId: streamId, bytesWritten: state.position, success: true))
    }
  }

  func isWriteStreamActive(streamId: String) throws -> NitroModules.Promise<Bool> {
    return Promise.async {
      guard let state = self.writeStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such write stream: \(streamId)"])
      }
      return state.isActive
    }
  }

  func getWriteStreamPosition(streamId: String) throws -> NitroModules.Promise<Int64> {
    return Promise.async {
      guard let state = self.writeStreams[streamId] else {
        throw NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: No such write stream: \(streamId)"])
      }
      return state.position
    }
  }

  // MARK: - Event Listener Registration

  func listenToReadStreamData(streamId: String, onData: @escaping (ReadStreamDataEvent) -> Void) throws -> () -> Void {
    readStreamDataListeners[streamId] = onData
    return { [weak self] in self?.readStreamDataListeners.removeValue(forKey: streamId) }
  }

  func listenToReadStreamProgress(streamId: String, onProgress: @escaping (ReadStreamProgressEvent) -> Void) throws -> () -> Void {
    readStreamProgressListeners[streamId] = onProgress
    return { [weak self] in self?.readStreamProgressListeners.removeValue(forKey: streamId) }
  }

  func listenToReadStreamEnd(streamId: String, onEnd: @escaping (ReadStreamEndEvent) -> Void) throws -> () -> Void {
    readStreamEndListeners[streamId] = onEnd
    return { [weak self] in self?.readStreamEndListeners.removeValue(forKey: streamId) }
  }

  func listenToReadStreamError(streamId: String, onError: @escaping (ReadStreamErrorEvent) -> Void) throws -> () -> Void {
    readStreamErrorListeners[streamId] = onError
    return { [weak self] in self?.readStreamErrorListeners.removeValue(forKey: streamId) }
  }

  func listenToWriteStreamProgress(streamId: String, onProgress: @escaping (WriteStreamProgressEvent) -> Void) throws -> () -> Void {
    writeStreamProgressListeners[streamId] = onProgress
    return { [weak self] in self?.writeStreamProgressListeners.removeValue(forKey: streamId) }
  }

  func listenToWriteStreamFinish(streamId: String, onFinish: @escaping (WriteStreamFinishEvent) -> Void) throws -> () -> Void {
    writeStreamFinishListeners[streamId] = onFinish
    return { [weak self] in self?.writeStreamFinishListeners.removeValue(forKey: streamId) }
  }

  func listenToWriteStreamError(streamId: String, onError: @escaping (WriteStreamErrorEvent) -> Void) throws -> () -> Void {
    writeStreamErrorListeners[streamId] = onError
    return { [weak self] in self?.writeStreamErrorListeners.removeValue(forKey: streamId) }
  }
}
