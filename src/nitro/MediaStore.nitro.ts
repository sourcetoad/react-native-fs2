import type { HybridObject } from 'react-native-nitro-modules';

export type MediaCollectionType = 'Audio' | 'Video' | 'Image' | 'Download';

export interface FileDescriptor {
  name: string; // Display name, e.g., "MyPhoto.jpg"
  mimeType: string; // e.g., "image/jpeg"
  relativePath?: string; // e.g., "Pictures/MyAlbum" (used for creating in a specific subfolder)
  title?: string; // Media title
  description?: string; // Media description
  dateAdded?: number; // Timestamp (ms since epoch) for when the file was added
  dateModified?: number; // Timestamp (ms since epoch) for when the file was last modified
  size?: number; // File size in bytes (more relevant for updates or if known)
}

export interface MediaStoreFile {
  uri: string; // Content URI, e.g., "content://media/external/images/media/123"
  name: string; // Display name
  mimeType: string;
  size: number; // Size in bytes
  dateAdded: number; // Timestamp (ms since epoch)
  dateModified: number; // Timestamp (ms since epoch)
  relativePath?: string; // Relative path within its collection, e.g., "Pictures/MyAlbum/"
  album?: string;
  artist?: string;
  // Add other common fields as necessary
}

export type SortDirection = 'asc' | 'desc';
export type SortByType = 'date_added' | 'date_modified' | 'name' | 'size';

export interface MediaStoreSearchOptions {
  mediaType: MediaCollectionType; // Which collection to query
  path?: string; // e.g., "Pictures/MyAlbum/" to search within a subfolder
  name?: string; // Search by file display name (can be partial with wildcards if supported by native impl)
  uri?: string; // Search by specific content URI
  offset?: number;
  limit?: number;
  sort?: SortDirection;
  sortBy?: SortByType;
}

export interface MediaStore
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Android MediaStore API
  // Note: These are Android platform-specific
  mediaStoreCreateFile(
    fileDescriptor: FileDescriptor,
    mediaCollection: MediaCollectionType
  ): Promise<string>; // Returns content URI (Android only)

  mediaStoreUpdateFile(
    uri: string, // Content URI of the file to update
    fileDescriptor: FileDescriptor,
    mediaCollection: MediaCollectionType
  ): Promise<string>; // Returns content URI, typically same as input (Android only)

  mediaStoreWriteToFile(
    uri: string, // Content URI to write to
    sourceFilePath: string // Path of the local file to write from
  ): Promise<void>; // (Android only)

  mediaStoreCopyFromFile( // Copies a local file into the MediaStore
    sourceFilePath: string,
    fileDescriptor: FileDescriptor, // Describes the new media file to be created
    mediaCollection: MediaCollectionType
  ): Promise<string>; // Returns content URI of the new file (Android only)

  mediaStoreQueryFiles(
    searchOptions: MediaStoreSearchOptions
  ): Promise<MediaStoreFile[]>; // (Android only)
  mediaStoreDeleteFile(uri: string): Promise<boolean>; // (Android only)
}
