import Foundation
import NitroModules

// Protocol for download event callbacks
protocol DownloaderDelegate: AnyObject {
  func downloadDidBegin(jobId: Int, contentLength: Int64, headers: [AnyHashable: Any]?)
  func downloadDidProgress(jobId: Int, contentLength: Int64, bytesWritten: Int64)
  func downloadDidComplete(jobId: Int, statusCode: Int, bytesWritten: Int64)
  func downloadDidError(jobId: Int, error: Error)
  func downloadCanBeResumed(jobId: Int)
  func downloadCleanup(jobId: Int)
}

class Downloader: NSObject, URLSessionDownloadDelegate {
  weak var delegate: DownloaderDelegate?

  // Single download state
  private var jobId: Int = 1
  private var url: URL?
  private var destination: String?
  private var task: URLSessionDownloadTask?
  private var resumeData: Data?
  private var session: URLSession?
  private var expectedContentLength: Int64 = -1
  private var headers: [String: String]?
  private var options: DownloadFileOptions?
  private var statusCode: Int? = nil
  private var lastProgressEmitTimestamp: TimeInterval = 0
  private var lastProgressValue: Int = -1

  // MARK: - Public API

  func startDownload(from url: URL, to destination: String, headers: [String: String]?, options: DownloadFileOptions?) {
    // Adopt the caller's jobId before anything can fail. The unwritable-destination path below
    // reports an error, and reporting it against the default 1 rejected the wrong job and left
    // the real one's continuation unresumed forever.
    if let options = options {
      jobId = Int(options.jobId)
    }

    if FileManager.default.fileExists(atPath: destination) {
      do {
        let fileHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: destination))
        try fileHandle.close()
      } catch {
        // If file cannot be opened for writing, call error delegate and do not start download
        delegate?.downloadDidError(jobId: jobId, error: NSError(domain: "Downloader", code: NSURLErrorFileDoesNotExist, userInfo: [NSLocalizedDescriptionKey: "Failed to write target file at path: \(destination)"]))
        return
      }
    }

    self.url = url
    self.destination = destination
    self.headers = headers
    self.options = options
    expectedContentLength = -1
    resumeData = nil

    var config: URLSessionConfiguration
    var isBackground = false
    if let options = options {
      isBackground = options.background ?? false
    }

    if isBackground {
      let uuid = UUID().uuidString
      config = URLSessionConfiguration.background(withIdentifier: "com.margelo.nitro.fs2.downloader.\(uuid)")
      if let discretionary = options?.discretionary {
        config.isDiscretionary = discretionary
      }
    } else {
      config = URLSessionConfiguration.default
    }

    if let cacheable = options?.cacheable, !cacheable {
      config.urlCache = nil
    }

    if let headers = headers {
      config.httpAdditionalHeaders = headers
    }

    if let readTimeout = options?.readTimeout {
      config.timeoutIntervalForRequest = Double(readTimeout) / 1000.0
    }

    if let backgroundTimeout = options?.backgroundTimeout {
      config.timeoutIntervalForResource = Double(backgroundTimeout) / 1000.0
    }

    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    let task = session.downloadTask(with: url)
    self.session = session
    self.task = task
    task.resume()
  }

  func stopDownload() {
    guard let task = task else { return }
    task.cancel { resumeDataOrNil in
      self.resumeData = resumeDataOrNil
    }
  }

  func resumeDownload() {
    guard let resumeData = resumeData else { return }
    var config: URLSessionConfiguration
    var isBackground = false
    if let options = options {
      isBackground = options.background ?? false
    }
    if isBackground {
      let uuid = UUID().uuidString
      config = URLSessionConfiguration.background(withIdentifier: "com.margelo.nitro.fs2.downloader.\(uuid)")
      if let discretionary = options?.discretionary {
        config.isDiscretionary = discretionary
      }
    } else {
      config = URLSessionConfiguration.default
    }
    if let headers = headers {
      config.httpAdditionalHeaders = headers
    }
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    let task = session.downloadTask(withResumeData: resumeData)
    self.session = session
    self.task = task
    self.resumeData = nil
    task.resume()
  }

  func isResumable() -> Bool {
    return resumeData != nil
  }

  private func clearState() {
    url = nil
    destination = nil
    task = nil
    session = nil
    expectedContentLength = -1
    headers = nil
    options = nil
    resumeData = nil
    statusCode = nil
    lastProgressEmitTimestamp = 0
    lastProgressValue = -1
  }

  // MARK: - URLSessionDownloadDelegate

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    // Capture the status as soon as a response exists, regardless of whether a length was
    // declared. Doing this only inside the `totalBytesExpectedToWrite > 0` branch left
    // `statusCode` nil for every chunked response, so a chunked 404 suppressed `begin` and
    // every progress event and was later reported to JS as 200.
    if statusCode == nil, let httpResponse = downloadTask.response as? HTTPURLResponse {
      statusCode = httpResponse.statusCode
    }

    if expectedContentLength == -1 && totalBytesExpectedToWrite > 0 {
      expectedContentLength = totalBytesExpectedToWrite
      // Get headers from response
      if let httpResponse = downloadTask.response as? HTTPURLResponse {
        let headers = httpResponse.allHeaderFields as? [String: String]
        delegate?.downloadDidBegin(jobId: jobId, contentLength: totalBytesExpectedToWrite, headers: headers)
      } else {
        delegate?.downloadDidBegin(jobId: jobId, contentLength: totalBytesExpectedToWrite, headers: nil)
      }
    }

    // Only fire progress if statusCode is 200 (legacy behavior)
    guard statusCode == 200 else { return }

    // Progress throttling logic
    let now = Date().timeIntervalSince1970
    let progressInterval = options?.progressInterval ?? 0
    let progressDivider = options?.progressDivider ?? 0
    var shouldEmit = false

    if progressInterval > 0 {
      if now - lastProgressEmitTimestamp > Double(progressInterval) / 1000.0 {
        lastProgressEmitTimestamp = now
        shouldEmit = true
      }
    } else if !progressDivider.isFinite || Int(progressDivider.rounded(.down)) <= 0 {
      // Anything that does not round down to a usable step - 0, a negative, NaN, or a
      // fraction like 0.5 - means "no throttling". Truncating a fraction to Int gave 0 and
      // trapped on the `% 0` below.
      shouldEmit = true
    } else {
      let divider = Int(progressDivider.rounded(.down))
      // Divider logic: emit only if percent changed by divider
      let percent = totalBytesExpectedToWrite > 0 ? Int((Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) * 100) : 0
      if percent % divider == 0 {
        if percent != lastProgressValue || totalBytesWritten == totalBytesExpectedToWrite {
          lastProgressValue = percent
          shouldEmit = true
        }
      }
    }
    if shouldEmit {
      delegate?.downloadDidProgress(jobId: jobId, contentLength: totalBytesExpectedToWrite, bytesWritten: totalBytesWritten)
    }
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard let destination = destination else { return }
    defer {
      self.session?.finishTasksAndInvalidate()
      self.clearState()
      delegate?.downloadCleanup(jobId: jobId)
    }

    // The response is authoritative here; `didWriteData` never runs for an empty body.
    if statusCode == nil, let httpResponse = downloadTask.response as? HTTPURLResponse {
      statusCode = httpResponse.statusCode
    }
    let code = statusCode ?? 200

    // Move file to destination
    let fileManager = FileManager.default
    let destURL = URL(fileURLWithPath: destination)

    // Only a 2xx body is the file the caller asked for. Moving unconditionally meant a 404
    // error page deleted and replaced an existing local file.
    guard (200...299).contains(code) else {
      delegate?.downloadDidComplete(jobId: jobId, statusCode: code, bytesWritten: 0)
      return
    }

    do {
      // Remove existing file if present
      if fileManager.fileExists(atPath: destURL.path) {
        try fileManager.removeItem(at: destURL)
      }
      try fileManager.moveItem(at: location, to: destURL)
      // Get file size
      let attrs = try fileManager.attributesOfItem(atPath: destURL.path)
      let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
      delegate?.downloadDidComplete(jobId: jobId, statusCode: code, bytesWritten: size)
    } catch {
      delegate?.downloadDidError(jobId: jobId, error: error)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    // `clearState()` nils `resumeData`, so running it unconditionally wiped the resume payload
    // the moment it was captured and left `isResumable()`/`resumeDownload()` permanently dead.
    var keepResumeState = false
    defer {
      self.session?.finishTasksAndInvalidate()
      if !keepResumeState {
        self.clearState()
      }
      delegate?.downloadCleanup(jobId: jobId)
    }

    if let error = error as NSError? {
      print("[Downloader] didCompleteWithError: \(error), userInfo: \(error.userInfo)")
      if let resumeData = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
        self.resumeData = resumeData
        keepResumeState = true
        delegate?.downloadCanBeResumed(jobId: jobId)
      } else {
        delegate?.downloadDidError(jobId: jobId, error: error)
      }
    } else {
      // No error, already handled in didFinishDownloadingTo
    }
  }
}
