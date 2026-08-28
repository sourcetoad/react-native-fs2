import Foundation
import NitroModules

class MediaStore: HybridMediaStoreSpec {
  func mediaStoreCreateFile(fileDescription: FileDescription, mediaCollection: MediaCollectionType) throws -> Promise<String> {
    throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
  }
  
  func mediaStoreUpdateFile(uri: String, fileDescription: FileDescription, mediaCollection: MediaCollectionType) throws -> Promise<String> {
    throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
  }
  
  func mediaStoreWriteToFile(uri: String, sourceFilePath: String) throws -> Promise<Void> {
    throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
  }
  
  func mediaStoreCopyFromFile(sourceFilePath: String, fileDescription: FileDescription, mediaCollection: MediaCollectionType) throws -> Promise<String> {
    throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
  }
  
  func mediaStoreQueryFile(searchOptions: MediaStoreSearchOptions) throws -> Promise<MediaStoreFile?> {
    throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
  }
  
  func mediaStoreDeleteFile(uri: String) throws -> Promise<Bool> {
    throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
  }
}
