import CommonCrypto
import Foundation
import NitroModules

class Fs2: HybridFs2Spec {
  public let cachesDirectoryPath: String
  public let documentDirectoryPath: String
  public let temporaryDirectoryPath: String
  public let libraryDirectoryPath: String
  public let picturesDirectoryPath: String
  public let externalCachesDirectoryPath: String = ""
  public let downloadDirectoryPath: String = ""
  public let externalDirectoryPath: String = ""
  public let externalStorageDirectoryPath: String = ""
  
  // Downloader instance
  private let downloader = Downloader()
  
  // Wrapper class for listener closures to allow reference comparison
  private class DownloadListenerWrapper {
    let callback: (DownloadEventResult) -> Void
    init(_ callback: @escaping (DownloadEventResult) -> Void) {
      self.callback = callback
    }
  }
  
  // Private struct to hold callbacks for a download job
  private struct DownloadListeners {
    var beginListeners: [DownloadListenerWrapper] = []
    var progressListeners: [DownloadListenerWrapper] = []
    var completeListeners: [DownloadListenerWrapper] = []
    var errorListeners: [DownloadListenerWrapper] = []
    var canBeResumedListeners: [DownloadListenerWrapper] = []
  }
  
  // Store DownloadCallbacksHolder per jobId
  private var downloadListeners = DownloadListeners()
  
  // Downloader instances per jobId
  private var downloaders: [Int: Downloader] = [:]
  
  override init() {
    self.cachesDirectoryPath = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.path ?? ""
    self.documentDirectoryPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.path ?? ""
    self.temporaryDirectoryPath = NSTemporaryDirectory()
    self.libraryDirectoryPath = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?.path ?? ""
    self.picturesDirectoryPath = FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask).first?.path ?? ""
    super.init()
    downloader.delegate = self
  }
  
  func readFile(filepath: String) -> Promise<ArrayBufferHolder> {
    return Promise<ArrayBufferHolder>.async {
      let fileManager = FileManager.default
      var isDir: ObjCBool = false
      
      guard fileManager.fileExists(atPath: filepath, isDirectory: &isDir) else {
        // Match original library's ENOENT error for file not found
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: no such file or directory, open '\(filepath)'"])
      }
      
      guard !isDir.boolValue else {
        // Match original library's EISDIR error for path is a directory
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EISDIR: path is a directory, not a file: \(filepath)"])
      }
      
      do {
        let fileData = try Data(contentsOf: URL(fileURLWithPath: filepath))
        let arrayBufferHolder = try ArrayBufferHolder.copy(data: fileData)
        return arrayBufferHolder
      } catch {
        // Catch other potential errors during file reading (e.g., permissions)
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EREAD: Failed to read file at path \(filepath): \(error.localizedDescription)"])
      }
    }
  }
  
  func writeFile(filepath: String, data: ArrayBufferHolder) -> Promise<Void> {
    return Promise<Void>.async {
      let fileManager = FileManager.default
      var isDir: ObjCBool = false
      
      // Check if path is a directory
      if fileManager.fileExists(atPath: filepath, isDirectory: &isDir) && isDir.boolValue {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EISDIR: path is a directory, cannot write file: \(filepath)"])
      }
      
      // Check if parent directory exists, create if not.
      // This behavior is common in file system libraries, ensuring the path is writable.
      let parentDirectoryURL = URL(fileURLWithPath: filepath).deletingLastPathComponent()
      if !fileManager.fileExists(atPath: parentDirectoryURL.path) {
        do {
          try fileManager.createDirectory(at: parentDirectoryURL, withIntermediateDirectories: true, attributes: nil)
        } catch {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EMKDIRP: Failed to create parent directories for path \(filepath): \(error.localizedDescription)"])
        }
      }
      
      do {
        let fileData = data.toData(copyIfNeeded: true) // Convert ArrayBufferHolder to Data
        try fileData.write(to: URL(fileURLWithPath: filepath))
        return // Return Void on success
      } catch {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EWRITE: Failed to write file to path \(filepath): \(error.localizedDescription)"])
      }
    }
  }
  
  func mkdir(filepath: String, options: MkdirOptions?) -> Promise<Void> {
    return Promise<Void>.async {
      let fileManager = FileManager.default
      var attributes: [FileAttributeKey: Any] = [:]
      
      if let options = options {
        if let fileProtection = options.fileProtection {
          switch fileProtection {
          case .nsfileprotectionnone:
            attributes[.protectionKey] = FileProtectionType.nsfileprotectionnone
          case .nsfileprotectioncomplete:
            attributes[.protectionKey] = FileProtectionType.nsfileprotectioncomplete
          case .nsfileprotectioncompleteunlessopen:
            attributes[.protectionKey] = FileProtectionType.nsfileprotectioncompleteunlessopen
          case .nsfileprotectioncompleteuntilfirstuserauthentication:
            attributes[.protectionKey] = FileProtectionType.nsfileprotectioncompleteuntilfirstuserauthentication
          @unknown default:
            break
          }
        }
        
        if let excludedFromBackup = options.excludedFromBackup, excludedFromBackup {
          // Note: The key for excluding from backup is NSURLIsExcludedFromBackupKey,
          // and it applies to a URL object, not directly as a file attribute for createDirectory.
          // This needs to be set *after* the directory is created.
          // We will handle this after the directory creation.
        }
      }
      
      do {
        try fileManager.createDirectory(atPath: filepath, withIntermediateDirectories: true, attributes: attributes.isEmpty ? nil : attributes)
        
        // Handle excludedFromBackup after directory creation
        if let options = options, let excludedFromBackup = options.excludedFromBackup, excludedFromBackup {
          var url = URL(fileURLWithPath: filepath)
          var resourceValues = URLResourceValues()
          resourceValues.isExcludedFromBackup = true
          try url.setResourceValues(resourceValues)
        }
        
        return // Return Void on success
      } catch {
        // Check if the error is because the file already exists and is a directory
        // This is a common case and might not be considered an error by all libraries/users.
        // For now, we will throw an error to be consistent with potential stricter error handling.
        var isDir: ObjCBool = false
        if fileManager.fileExists(atPath: filepath, isDirectory: &isDir) && isDir.boolValue {
          // If it already exists and is a directory, some might consider this a success.
          // However, createDirectory itself throws if it exists and is a file, or if it exists as a dir and withIntermediateDirectories is false.
          // Since we use withIntermediateDirectories: true, it won\'t error if parent dirs exist.
          // If the directory itself already exists, createDirectoryAtPath does not error out.
          // So, we might not need this specific check unless we want to differentiate "created now" vs "already existed".
          // For now, let\'s assume standard createDirectory behavior is fine.
        }
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EMKDIR: Failed to create directory at path \(filepath): \(error.localizedDescription)"])
      }
    }
  }
  
  func exists(filepath: String) -> Promise<Bool> {
    return Promise<Bool>.async {
      let fileManager = FileManager.default
      // fileExists(atPath:) returns true if the file or directory exists, which is what we want.
      // It doesn't throw an error, just returns false if not found or on other errors (like permission issues for a component of the path).
      return fileManager.fileExists(atPath: filepath)
    }
  }
  
  public func unlink(filepath: String) throws -> Promise<Void> {
    return Promise.async {
      let fileManager = FileManager.default
      // Nitro uses file:// scheme, remove it for direct file system access
      let path = Self.normalizePath(filepath)
      
      guard fileManager.fileExists(atPath: path) else {
        // File doesn't exist, so it's already "unlinked" in a sense.
        // Original library didn't throw an error here, so we won't either.
        // However, if it's a directory and not empty, removeItemAtPath would fail.
        // For consistency with original, we don't check for directory emptiness here.
        return
      }
      
      do {
        try fileManager.removeItem(atPath: path)
      } catch {
        // Re-throw the error to be caught by Nitro and sent to JS
        throw error
      }
    }
  }
  
  // Helper function to normalize file paths by removing "file://" prefix if present
  private static func normalizePath(_ path: String) -> String {
    if path.hasPrefix("file://") {
      return String(path.dropFirst("file://".count))
    }
    return path
  }
  
  func readDir(dirPath: String) -> Promise<[ReadDirItem]> {
    return Promise<[ReadDirItem]>.async {
      let fileManager = FileManager.default
      let normalizedDirPath = Self.normalizePath(dirPath)
      var isDirObj: ObjCBool = false
      
      guard fileManager.fileExists(atPath: normalizedDirPath, isDirectory: &isDirObj) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: Directory not found at path: \(normalizedDirPath)"])
      }
      guard isDirObj.boolValue else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOTDIR: Path is not a directory: \(normalizedDirPath)"])
      }
      
      do {
        let itemNames = try fileManager.contentsOfDirectory(atPath: normalizedDirPath)
        var dirItems: [ReadDirItem] = []
        
        for itemName in itemNames {
          let itemPath = (normalizedDirPath as NSString).appendingPathComponent(itemName)
          let attributes = try fileManager.attributesOfItem(atPath: itemPath)
          
          let name = itemName
          let path = itemPath // Full path
          let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
          let modificationDate = attributes[.modificationDate] as? Date
          let creationDate = attributes[.creationDate] as? Date // Get creation date
          let fileType = attributes[.type] as? FileAttributeType
          
          let isFile = (fileType == .typeRegular)
          let isDirectory = (fileType == .typeDirectory)
          let mtime = Int(modificationDate?.timeIntervalSince1970 ?? 0)
          let ctime = Int(creationDate?.timeIntervalSince1970 ?? 0) // Convert creationDate to timestamp
          
          dirItems.append(ReadDirItem(name: name,
                                      path: path,
                                      size: Double(size),
                                      isFile: isFile,
                                      isDirectory: isDirectory,
                                      mtime: Double(mtime),
                                      ctime: Double(ctime)))
        }
        return dirItems
      } catch {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EREADDIR: Failed to read directory at path \(normalizedDirPath): \(error.localizedDescription)"])
      }
    }
  }
  
  func stat(filepath: String) -> Promise<NativeStatResult> {
    return Promise<NativeStatResult>.async {
      let fileManager = FileManager.default
      let normalizedFilepath = Self.normalizePath(filepath)
      var isDirObj: ObjCBool = false
      
      guard fileManager.fileExists(atPath: normalizedFilepath, isDirectory: &isDirObj) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: File or directory not found at path: \(normalizedFilepath)"])
      }
      
      do {
        let attributes = try fileManager.attributesOfItem(atPath: normalizedFilepath)
        
        let size = (attributes[.size] as? NSNumber)?.doubleValue ?? 0.0
        let modificationDate = attributes[.modificationDate] as? Date
        let creationDate = attributes[.creationDate] as? Date
        let fileTypeAttr = attributes[.type] as? FileAttributeType
        let fileMode = attributes[.posixPermissions] as? NSNumber
        
        let isDirectory = (fileTypeAttr == .typeDirectory)
        let mtime = Double(modificationDate?.timeIntervalSince1970 ?? 0)
        let ctime = Double(creationDate?.timeIntervalSince1970 ?? (modificationDate?.timeIntervalSince1970 ?? 0))
        let type: StatResultType = isDirectory ? .directory : .file
        
        return NativeStatResult(
          mode: fileMode?.doubleValue,
          ctime: ctime,
          mtime: mtime,
          size: size,
          type: type,
          originalFilepath: normalizedFilepath
        )
      } catch {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ESTAT: Failed to get stat for path \(normalizedFilepath): \(error.localizedDescription)"])
      }
    }
  }
  
  func hash(filepath: String, algorithm: HashAlgorithm) -> Promise<String> {
    return Promise<String>.async {
      let normalizedFilepath = Self.normalizePath(filepath)
      let fileManager = FileManager.default
      var isDirObj: ObjCBool = false
      
      guard fileManager.fileExists(atPath: normalizedFilepath, isDirectory: &isDirObj) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: File not found at path: \(normalizedFilepath)"])
      }
      
      guard !isDirObj.boolValue else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EISDIR: Path is a directory, cannot hash: \(normalizedFilepath)"])
      }
      
      guard let fileURL = URL(string: "file://\(normalizedFilepath)") else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EURL: Could not create URL for path: \(normalizedFilepath)"])
      }
      
      guard let fileData = try? Data(contentsOf: fileURL) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EREAD: Could not read file data from path: \(normalizedFilepath)"])
      }
      
      var digest = [UInt8]()
      let data = fileData as NSData
      
      switch algorithm {
      case .md5:
        digest = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
        CC_MD5(data.bytes, CC_LONG(data.length), &digest)
      case .sha1:
        digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        CC_SHA1(data.bytes, CC_LONG(data.length), &digest)
      case .sha256:
        digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        CC_SHA256(data.bytes, CC_LONG(data.length), &digest)
      case .sha384:
        digest = [UInt8](repeating: 0, count: Int(CC_SHA384_DIGEST_LENGTH))
        CC_SHA384(data.bytes, CC_LONG(data.length), &digest)
      case .sha512:
        digest = [UInt8](repeating: 0, count: Int(CC_SHA512_DIGEST_LENGTH))
        CC_SHA512(data.bytes, CC_LONG(data.length), &digest)
        // default case should not be reached due to HashAlgorithm type enforcement from TypeScript
      }
      
      return digest.map { String(format: "%02hhx", $0) }.joined()
    }
  }
  
  func moveFile(filepath: String, destPath: String) -> Promise<Void> {
    return Promise<Void>.async {
      let fileManager = FileManager.default
      let normalizedFilepath = Self.normalizePath(filepath)
      let normalizedDestPath = Self.normalizePath(destPath)
      
      // Check if source exists
      guard fileManager.fileExists(atPath: normalizedFilepath) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: Source file not found at path: \(normalizedFilepath)"])
      }
      
      // If destination is a directory, append the source filename to the destination path
      var isDestDir: ObjCBool = false
      var finalDestPath = normalizedDestPath
      if fileManager.fileExists(atPath: normalizedDestPath, isDirectory: &isDestDir) && isDestDir.boolValue {
        let sourceFileName = (normalizedFilepath as NSString).lastPathComponent
        finalDestPath = (normalizedDestPath as NSString).appendingPathComponent(sourceFileName)
      }
      
      // Ensure parent directory of destination exists
      let destParentDir = (finalDestPath as NSString).deletingLastPathComponent
      if !fileManager.fileExists(atPath: destParentDir) {
        try fileManager.createDirectory(atPath: destParentDir, withIntermediateDirectories: true, attributes: nil)
      }
      
      // Attempt to move the file
      do {
        // If a file/directory already exists at finalDestPath, removeItem first.
        // This mimics the behavior of some `mv` commands (overwrite).
        if fileManager.fileExists(atPath: finalDestPath) {
          try fileManager.removeItem(atPath: finalDestPath)
        }
        try fileManager.moveItem(atPath: normalizedFilepath, toPath: finalDestPath)
        return // Return Void on success
      } catch {
        // Attempt to copy and delete if move fails (e.g., across different volumes)
        // This is a common fallback strategy.
        do {
          if fileManager.fileExists(atPath: finalDestPath) { // If previous removeItem failed or this is a retry
            try fileManager.removeItem(atPath: finalDestPath)
          }
          try fileManager.copyItem(atPath: normalizedFilepath, toPath: finalDestPath)
          try fileManager.removeItem(atPath: normalizedFilepath) // Delete original after successful copy
          return // Return Void on success
        } catch let fallbackError {
          // If both move and copy-delete fail, throw an error reflecting the move operation
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EMOVE: Failed to move file from \(normalizedFilepath) to \(finalDestPath). Move error: \(error.localizedDescription). Fallback copy error: \(fallbackError.localizedDescription)"])
        }
      }
    }
  }
  
  func copyFile(filepath: String, destPath: String) -> Promise<Void> {
    return Promise<Void>.async {
      let fileManager = FileManager.default
      let normalizedFilepath = Self.normalizePath(filepath)
      let normalizedDestPath = Self.normalizePath(destPath)
      
      // Check if source exists
      guard fileManager.fileExists(atPath: normalizedFilepath) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: Source file not found at path: \(normalizedFilepath)"])
      }
      
      // If destination is a directory, append the source filename to the destination path
      var isDestDir: ObjCBool = false
      var finalDestPath = normalizedDestPath
      if fileManager.fileExists(atPath: normalizedDestPath, isDirectory: &isDestDir) && isDestDir.boolValue {
        let sourceFileName = (normalizedFilepath as NSString).lastPathComponent
        finalDestPath = (normalizedDestPath as NSString).appendingPathComponent(sourceFileName)
      }
      
      // Ensure parent directory of destination exists
      let destParentDir = (finalDestPath as NSString).deletingLastPathComponent
      if !fileManager.fileExists(atPath: destParentDir) {
        try fileManager.createDirectory(atPath: destParentDir, withIntermediateDirectories: true, attributes: nil)
      }
      
      // Attempt to copy the file
      do {
        // If a file/directory already exists at finalDestPath, removeItem first.
        // This mimics the behavior of some `cp` commands (overwrite).
        if fileManager.fileExists(atPath: finalDestPath) {
          try fileManager.removeItem(atPath: finalDestPath)
        }
        try fileManager.copyItem(atPath: normalizedFilepath, toPath: finalDestPath)
        return // Return Void on success
      } catch {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ECOPY: Failed to copy file from \(normalizedFilepath) to \(finalDestPath): \(error.localizedDescription)"])
      }
    }
  }
  
  func appendFile(filepath: String, data: ArrayBufferHolder) -> Promise<Void> {
    return Promise<Void>.async {
      let normalizedPath = Self.normalizePath(filepath)
      let fileManager = FileManager.default
      
      var isDir: ObjCBool = false
      if fileManager.fileExists(atPath: normalizedPath, isDirectory: &isDir) && isDir.boolValue {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EISDIR: Path is a directory, cannot append: \(normalizedPath)"])
      }
      
      let fileData = data.toData(copyIfNeeded: true)
      
      if let fileHandle = FileHandle(forUpdatingAtPath: normalizedPath) {
        defer {
          do {
            try fileHandle.close()
          } catch {
            // Log error or handle, though primary write error is caught below
            print("Error closing file handle for append: \(error.localizedDescription)")
          }
        }
        do {
          try fileHandle.seekToEnd()
          try fileHandle.write(contentsOf: fileData)
          return
        } catch {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EAPPEND: Failed to append data to file \(normalizedPath): \(error.localizedDescription)"])
        }
      } else {
        // File does not exist, create it and write data (same as writeFile essentially)
        do {
          // Ensure parent directory exists
          let parentDirectoryURL = URL(fileURLWithPath: normalizedPath).deletingLastPathComponent()
          if !fileManager.fileExists(atPath: parentDirectoryURL.path) {
            try fileManager.createDirectory(at: parentDirectoryURL, withIntermediateDirectories: true, attributes: nil)
          }
          try fileData.write(to: URL(fileURLWithPath: normalizedPath))
          return
        } catch {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EWRITE: Failed to create and write file at path \(normalizedPath) during append operation: \(error.localizedDescription)"])
        }
      }
    }
  }
  
  func getFSInfo() -> Promise<FSInfoResult> {
    return Promise<FSInfoResult>.async {
      let fileManager = FileManager.default
      // Get the path to the app's documents directory, which is part of the sandbox.
      // File system attributes are typically queried against a path within the target file system.
      guard let documentsDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EPATH: Could not determine documents directory path."])
      }
      
      do {
        let attributes = try fileManager.attributesOfFileSystem(forPath: documentsDirectory.path)
        let totalSpace = attributes[.systemSize] as? NSNumber
        let freeSpace = attributes[.systemFreeSize] as? NSNumber
        
        guard let total = totalSpace, let free = freeSpace else {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EATTR: Could not retrieve file system size attributes."])
        }
        
        return FSInfoResult(totalSpace: total.doubleValue, freeSpace: free.doubleValue)
      } catch {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EFSINFO: Failed to get file system info: \(error.localizedDescription)"])
      }
    }
  }
  
  func read(filepath: String, length: Double, position: Double) -> Promise<ArrayBufferHolder> {
    return Promise<ArrayBufferHolder>.async {
      let normalizedPath = Self.normalizePath(filepath)
      let fileManager = FileManager.default
      
      var isDir: ObjCBool = false
      guard fileManager.fileExists(atPath: normalizedPath, isDirectory: &isDir) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: File not found at path: \(normalizedPath)"])
      }
      
      guard !isDir.boolValue else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EISDIR: Path is a directory, cannot read: \(normalizedPath)"])
      }
      
      if let fileHandle = FileHandle(forReadingAtPath: normalizedPath) {
        defer {
          do {
            try fileHandle.close()
          } catch {
            print("Error closing file handle: \(error.localizedDescription)")
          }
        }
        
        do {
          // Seek to the specified position
          try fileHandle.seek(toOffset: UInt64(position))
          
          // Read the specified number of bytes
          let data = try fileHandle.read(upToCount: Int(length)) ?? Data()
          
          // Convert to ArrayBufferHolder and return
          let arrayBufferHolder = try ArrayBufferHolder.copy(data: data)
          return arrayBufferHolder
        } catch {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EREAD: Failed to read file at path \(normalizedPath): \(error.localizedDescription)"])
        }
      } else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EOPEN: Failed to open file at path \(normalizedPath)"])
      }
    }
  }
  
  func write(filepath: String, data: ArrayBufferHolder, position: Double?) -> Promise<Void> {
    return Promise<Void>.async {
      let normalizedPath = Self.normalizePath(filepath)
      let fileManager = FileManager.default
      
      var isDir: ObjCBool = false
      if fileManager.fileExists(atPath: normalizedPath, isDirectory: &isDir) && isDir.boolValue {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EISDIR: Path is a directory, cannot write: \(normalizedPath)"])
      }
      
      let fileData = data.toData(copyIfNeeded: true)
      
      // If file doesn't exist, create it with the data and return
      if !fileManager.fileExists(atPath: normalizedPath) {
        let parentDirectoryURL = URL(fileURLWithPath: normalizedPath).deletingLastPathComponent()
        if !fileManager.fileExists(atPath: parentDirectoryURL.path) {
          do {
            try fileManager.createDirectory(at: parentDirectoryURL, withIntermediateDirectories: true, attributes: nil)
          } catch {
            throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EMKDIRP: Failed to create parent directories for path \(normalizedPath): \(error.localizedDescription)"])
          }
        }
        let success = fileManager.createFile(atPath: normalizedPath, contents: fileData, attributes: nil)
        if !success {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: no such file or directory, open '\(normalizedPath)'"])
        }
        return
      }
      
      // File exists, open for updating
      if let fileHandle = FileHandle(forUpdatingAtPath: normalizedPath) {
        defer {
          do {
            try fileHandle.close()
          } catch {
            print("Error closing file handle: \(error.localizedDescription)")
          }
        }
        
        do {
          if let pos = position, pos >= 0 {
            try fileHandle.seek(toOffset: UInt64(pos))
          } else {
            try fileHandle.seekToEnd()
          }
          try fileHandle.write(contentsOf: fileData)
          return
        } catch {
          throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EWRITE: Failed to write data to file \(normalizedPath): \(error.localizedDescription)"])
        }
      } else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "EOPEN: Failed to open file at path \(normalizedPath)"])
      }
    }
  }
  
  func touch(filepath: String, mtime: Double?, ctime: Double?) -> Promise<Void> {
    return Promise<Void>.async {
      let fileManager = FileManager.default
      let normalizedPath = Self.normalizePath(filepath)
      var isDir: ObjCBool = false
      
      guard fileManager.fileExists(atPath: normalizedPath, isDirectory: &isDir) else {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: no such file, open '\(normalizedPath)'"])
      }
      
      var attributes = [FileAttributeKey: Any]()
      
      if let mtimeValue = mtime {
        let mtimeDate = Date(timeIntervalSince1970: mtimeValue / 1000) // Convert from milliseconds to seconds
        attributes[.modificationDate] = mtimeDate
      }
      
      if let ctimeValue = ctime {
        let ctimeDate = Date(timeIntervalSince1970: ctimeValue / 1000) // Convert from milliseconds to seconds
        attributes[.creationDate] = ctimeDate
      }
      
      do {
        try fileManager.setAttributes(attributes, ofItemAtPath: normalizedPath)
        return
      } catch {
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "ETOUCH: Failed to touch file at path \(normalizedPath): \(error.localizedDescription)"])
      }
    }
  }
  
  // Download Functionality
  func downloadFile(
    options: DownloadFileOptions,
    headers: [String: String]?
  ) -> Promise<Double> {
    return Promise<Double>.async {
      let processedHeaders: [String: String]? = nil
      guard let url = URL(string: options.fromUrl) else {
        let errorEvent = DownloadEventResult(
          jobId: -1,
          headers: nil,
          contentLength: nil,
          statusCode: nil,
          bytesWritten: nil,
          error: "Invalid URL: \(options.fromUrl)"
        )
        for wrapper in self.downloadListeners.errorListeners { wrapper.callback(errorEvent) }
        throw NSError(domain: "RNFS", code: 0, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(options.fromUrl)"])
      }
      
      let jobId = Int(options.jobId)
      let downloader = Downloader()
      downloader.delegate = self
      self.downloaders[jobId] = downloader
      downloader.startDownload(from: url, to: options.toFile, headers: processedHeaders, options: options)
      return Double(jobId)
    }
  }
  
  func stopDownload(jobId: Double) -> Promise<Void> {
    return Promise<Void>.async {
      let intJobId = Int(jobId)
      self.downloaders[intJobId]?.stopDownload()
      // Only cleanup if not resumable
      if let downloader = self.downloaders[intJobId], !downloader.isResumable() {
        self.downloaders.removeValue(forKey: intJobId)
      }
    }
  }
  
  func resumeDownload(jobId: Double) -> Promise<Void> {
    return Promise<Void>.async {
      let intJobId = Int(jobId)
      self.downloaders[intJobId]?.resumeDownload()
    }
  }
  
  func isResumable(jobId: Double) -> Promise<Bool> {
    return Promise<Bool>.async {
      let intJobId = Int(jobId)
      return self.downloaders[intJobId]?.isResumable() ?? false
    }
  }

  // download listeners
  func listenToDownloadBegin(onDownloadBegin: ((DownloadEventResult) -> Void)?) -> (() -> Void) {
    guard let onDownloadBegin = onDownloadBegin else { return {} }
    let wrapper = DownloadListenerWrapper(onDownloadBegin)
    downloadListeners.beginListeners.append(wrapper)
    return { [weak self, weak wrapper] in
      guard let self = self, let wrapper = wrapper else { return }
      if let idx = self.downloadListeners.beginListeners.firstIndex(where: { $0 === wrapper }) {
        self.downloadListeners.beginListeners.remove(at: idx)
      }
    }
  }

  func listenToDownloadProgress(onDownloadProgress: ((DownloadEventResult) -> Void)?) -> (() -> Void) {
    guard let onDownloadProgress = onDownloadProgress else { return {} }
    let wrapper = DownloadListenerWrapper(onDownloadProgress)
    downloadListeners.progressListeners.append(wrapper)
    return { [weak self, weak wrapper] in
      guard let self = self, let wrapper = wrapper else { return }
      if let idx = self.downloadListeners.progressListeners.firstIndex(where: { $0 === wrapper }) {
        self.downloadListeners.progressListeners.remove(at: idx)
      }
    }
  }

  func listenToDownloadComplete(onDownloadComplete: ((DownloadEventResult) -> Void)?) -> (() -> Void) {
    guard let onDownloadComplete = onDownloadComplete else { return {} }
    let wrapper = DownloadListenerWrapper(onDownloadComplete)
    downloadListeners.completeListeners.append(wrapper)
    return { [weak self, weak wrapper] in
      guard let self = self, let wrapper = wrapper else { return }
      if let idx = self.downloadListeners.completeListeners.firstIndex(where: { $0 === wrapper }) {
        self.downloadListeners.completeListeners.remove(at: idx)
      }
    }
  }

  func listenToDownloadError(onDownloadError: ((DownloadEventResult) -> Void)?) -> (() -> Void) {
    guard let onDownloadError = onDownloadError else { return {} }
    let wrapper = DownloadListenerWrapper(onDownloadError)
    downloadListeners.errorListeners.append(wrapper)
    return { [weak self, weak wrapper] in
      guard let self = self, let wrapper = wrapper else { return }
      if let idx = self.downloadListeners.errorListeners.firstIndex(where: { $0 === wrapper }) {
        self.downloadListeners.errorListeners.remove(at: idx)
      }
    }
  }

  func listenToDownloadCanBeResumed(onDownloadCanBeResumed: ((DownloadEventResult) -> Void)?) -> (() -> Void) {
    guard let onDownloadCanBeResumed = onDownloadCanBeResumed else { return {} }
    let wrapper = DownloadListenerWrapper(onDownloadCanBeResumed)
    downloadListeners.canBeResumedListeners.append(wrapper)
    return { [weak self, weak wrapper] in
      guard let self = self, let wrapper = wrapper else { return }
      if let idx = self.downloadListeners.canBeResumedListeners.firstIndex(where: { $0 === wrapper }) {
        self.downloadListeners.canBeResumedListeners.remove(at: idx)
      }
    }
  }

  // misc
  func scanFile(path: String) -> Promise<[String]> {
    return Promise<[String]>.async {
      []
    }
  }

  func getAllExternalFilesDirs() -> Promise<[String]> {
    return Promise<[String]>.async {
      []
    }
  }
}

// MARK: - DownloaderDelegate

extension Fs2: DownloaderDelegate {
  func downloadDidBegin(jobId: Int, contentLength: Int64, headers: [AnyHashable: Any]?) {
    let headersDict = headers ?? [:]
    let tempHeaderMap = AnyMapHolder()

    // var anyValueDictionary: [String: AnyValue] = [:]
    for (key, stringValue) in headersDict {
      // Wrap each String value in AnyValue.string case
      // anyValueDictionary[key as! String] = .string(stringValue as! String)
      
      tempHeaderMap.setString(key: key as! String, value: stringValue as! String)
    }

    // tempHeaderMap.setObject(key: "options", value: anyValueDictionary)
    
    let event = DownloadEventResult(
      jobId: Double(jobId),
      headers: tempHeaderMap,
      contentLength: Double(contentLength),
      statusCode: nil,
      bytesWritten: nil,
      error: nil
    )

    for wrapper in self.downloadListeners.beginListeners { wrapper.callback(event) }
  }

  func downloadDidProgress(jobId: Int, contentLength: Int64, bytesWritten: Int64) {
    let event = DownloadEventResult(
      jobId: Double(jobId),
      headers: nil,
      contentLength: Double(contentLength),
      statusCode: nil,
      bytesWritten: Double(bytesWritten),
      error: nil
    )

    for wrapper in self.downloadListeners.progressListeners { wrapper.callback(event) }
  }

  func downloadDidComplete(jobId: Int, statusCode: Int, bytesWritten: Int64) {
    let result = DownloadEventResult(
      jobId: Double(jobId),
      headers: nil,
      contentLength: nil,
      statusCode: Double(statusCode),
      bytesWritten: Double(bytesWritten),
      error: nil
    )

    for wrapper in self.downloadListeners.completeListeners { wrapper.callback(result) }
    // Always cleanup on complete
    self.downloaders.removeValue(forKey: jobId)
  }

  func downloadDidError(jobId: Int, error: Error) {
    let event = DownloadEventResult(
      jobId: Double(jobId),
      headers: nil,
      contentLength: nil,
      statusCode: nil,
      bytesWritten: nil,
      error: error.localizedDescription
    )

    for wrapper in self.downloadListeners.errorListeners { wrapper.callback(event) }
    // Only cleanup if not resumable
    if let downloader = self.downloaders[jobId], !downloader.isResumable() {
      self.downloaders.removeValue(forKey: jobId)
    }
  }

  func downloadCanBeResumed(jobId: Int) {
    let event = DownloadEventResult(
      jobId: Double(jobId),
      headers: nil,
      contentLength: nil,
      statusCode: nil,
      bytesWritten: nil,
      error: nil
    )
    for wrapper in self.downloadListeners.canBeResumedListeners { wrapper.callback(event) }
  }
}
