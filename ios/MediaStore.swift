import Foundation
import NitroModules

class MediaStore: HybridMediaStoreSpec {
  func mediaStoreCreateFile(fileDescriptor: FileDescriptor, mediaCollection: MediaCollectionType) throws -> Promise<String> {
    throw NSError(domain: "MediaStore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not supported on iOS"])
  }
  
  func mediaStoreUpdateFile(uri: String, fileDescriptor: FileDescriptor, mediaCollection: MediaCollectionType) throws -> Promise<String> {
    throw NSError(domain: "MediaStore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not supported on iOS"])
  }
  
  func mediaStoreWriteToFile(uri: String, sourceFilePath: String) throws -> Promise<Void> {
    throw NSError(domain: "MediaStore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not supported on iOS"])
  }
  
  func mediaStoreCopyFromFile(sourceFilePath: String, fileDescriptor: FileDescriptor, mediaCollection: MediaCollectionType) throws -> Promise<String> {
    throw NSError(domain: "MediaStore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not supported on iOS"])
  }
  
  func mediaStoreQueryFiles(searchOptions: MediaStoreSearchOptions) throws -> Promise<[MediaStoreFile]> {
    throw NSError(domain: "MediaStore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not supported on iOS"])
  }
  
  func mediaStoreDeleteFile(uri: String) throws -> Promise<Bool> {
    throw NSError(domain: "MediaStore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not supported on iOS"])
  }
}
