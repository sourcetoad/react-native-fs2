import type { HybridObject } from 'react-native-nitro-modules';

export type MediaCollectionType = 'Audio' | 'Video' | 'Image' | 'Download';

export interface FileDescription {
  name: string; // Display name, e.g., "MyPhoto.jpg"
  mimeType: string; // e.g., "image/jpeg"
  parentFolder: string; // e.g., "MyFolderName"
}

export interface MediaStoreFile {
  uri: string; // Content URI, e.g., "content://media/external/images/media/123"
  name: string; // Display name
  mimeType: string; // e.g., "image/jpeg"
  size: number; // Size in bytes
  dateAdded?: bigint; // Timestamp (ms since epoch)
  dateModified?: bigint; // Timestamp (ms since epoch)
  relativePath?: string; // Relative path within its collection, e.g., "Pictures/MyAlbum/"
}

export interface MediaStoreSearchOptions {
  uri?: string; // Search by specific content URI
  fileName?: string; // Search by file display name (can be partial with wildcards if supported by native impl)
  relativePath?: string; // e.g., "Pictures/MyAlbum/" to search within a subfolder
  mediaType: MediaCollectionType; // Which collection to query
}

export interface MediaStore
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  mediaStoreCreateFile(
    fileDescription: FileDescription,
    mediaCollection: MediaCollectionType
  ): Promise<string>; // Returns content URI (Android only)

  mediaStoreUpdateFile(
    uri: string, // Content URI of the file to update
    fileDescription: FileDescription,
    mediaCollection: MediaCollectionType
  ): Promise<string>; // Returns content URI, typically same as input (Android only)

  mediaStoreWriteToFile(
    uri: string, // Content URI to write to
    sourceFilePath: string // Path of the local file to write from
  ): Promise<void>; // (Android only)

  mediaStoreCopyFromFile( // Copies a local file into the MediaStore
    sourceFilePath: string,
    fileDescription: FileDescription, // Describes the new media file to be created
    mediaCollection: MediaCollectionType
  ): Promise<string>; // Returns content URI of the new file (Android only)

  mediaStoreQueryFile(
    searchOptions: MediaStoreSearchOptions
  ): Promise<MediaStoreFile | undefined>; // (Android only)
  mediaStoreDeleteFile(uri: string): Promise<boolean>; // (Android only)
}
