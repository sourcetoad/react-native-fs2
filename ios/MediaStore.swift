import Foundation
import NitroModules

/// Every method is Android-only.
///
/// The throws happen inside `Promise.async` rather than synchronously from the method body.
/// A synchronous throw out of a `throws -> Promise<T>` reaches JS as
/// `MediaStore.mediaStoreQueryFile(...): ENOTSUP: ...` - Nitro prefixes the method name -
/// which breaks the `err.message.startsWith('ENOTSUP')` contract the rest of this module
/// keeps. Rejecting the promise instead delivers the message verbatim.
class MediaStore: HybridMediaStoreSpec {
  func mediaStoreCreateFile(fileDescription: FileDescription, mediaCollection: MediaCollectionType) -> Promise<String> {
    return Promise<String>.async {
      throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
    }
  }
  
  func mediaStoreUpdateFile(uri: String, fileDescription: FileDescription, mediaCollection: MediaCollectionType) -> Promise<String> {
    return Promise<String>.async {
      throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
    }
  }
  
  func mediaStoreWriteToFile(uri: String, sourceFilePath: String) -> Promise<Void> {
    return Promise<Void>.async {
      throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
    }
  }
  
  func mediaStoreCopyFromFile(sourceFilePath: String, fileDescription: FileDescription, mediaCollection: MediaCollectionType) -> Promise<String> {
    return Promise<String>.async {
      throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
    }
  }
  
  func mediaStoreQueryFile(searchOptions: MediaStoreSearchOptions) -> Promise<MediaStoreFile?> {
    return Promise<MediaStoreFile?>.async {
      throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
    }
  }
  
  func mediaStoreDeleteFile(uri: String) -> Promise<Bool> {
    return Promise<Bool>.async {
      throw RuntimeError.error(withMessage: "ENOTSUP: MediaStore is not supported on iOS")
    }
  }
}
