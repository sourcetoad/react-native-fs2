import Foundation
import NitroModules

// Protocol for download event callbacks
protocol DownloaderDelegate: AnyObject {
  func downloadDidBegin(jobId: Int, contentLength: Int64, headers: [AnyHashable: Any]?)
  func downloadDidProgress(jobId: Int, contentLength: Int64, bytesWritten: Int64)
  func downloadDidComplete(jobId: Int, statusCode: Int, bytesWritten: Int64)
  func downloadDidError(jobId: Int, error: Error)
  func downloadCanBeResumed(jobId: Int)
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
      jobId = Int(options.jobId ?? 1)
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
    if expectedContentLength == -1 && totalBytesExpectedToWrite > 0 {
      expectedContentLength = totalBytesExpectedToWrite
      // Get headers from response
      if let httpResponse = downloadTask.response as? HTTPURLResponse {
        let headers = httpResponse.allHeaderFields as? [String: String]
        statusCode = httpResponse.statusCode
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
    } else if progressDivider <= 0 {
      shouldEmit = true
    } else {
      // Divider logic: emit only if percent changed by divider
      let percent = totalBytesExpectedToWrite > 0 ? Int((Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) * 100) : 0
      if percent % Int(progressDivider) == 0 {
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
    }

    // Move file to destination
    let fileManager = FileManager.default
    let destURL = URL(fileURLWithPath: destination)

    do {
      // Remove existing file if present
      if fileManager.fileExists(atPath: destURL.path) {
        try fileManager.removeItem(at: destURL)
      }
      try fileManager.moveItem(at: location, to: destURL)
      // Get file size
      let attrs = try fileManager.attributesOfItem(atPath: destURL.path)
      let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
      // Use stored statusCode if available, otherwise 200
      let code = statusCode ?? 200
      delegate?.downloadDidComplete(jobId: jobId, statusCode: code, bytesWritten: size)
    } catch {
      delegate?.downloadDidError(jobId: jobId, error: error)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer {
      self.session?.finishTasksAndInvalidate()
      self.clearState()
    }

    if let error = error as NSError? {
      print("[Downloader] didCompleteWithError: \(error), userInfo: \(error.userInfo)")
      if let resumeData = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
        self.resumeData = resumeData
        delegate?.downloadCanBeResumed(jobId: jobId)
      } else {
        delegate?.downloadDidError(jobId: jobId, error: error)
      }
    } else {
      // No error, already handled in didFinishDownloadingTo
    }
  }
}
