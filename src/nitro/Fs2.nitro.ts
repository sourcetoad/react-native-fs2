import type { HybridObject, AnyMap } from 'react-native-nitro-modules';

export interface ReadDirItem {
  name: string;
  path: string;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  mtime: number; // timestamp
  ctime?: number; // creation timestamp (best effort, iOS provides it, Android will use mtime)
}

// Define the new type for StatResult's type field
export type StatResultType = 'file' | 'directory';

export interface NativeStatResult {
  mode?: number; // iOS only, UNIX file mode
  ctime: number; // Created date
  mtime: number; // Last modified date
  size: number; // Size in bytes
  type: StatResultType;
  originalFilepath: string;
}

// For MkdirOptions
export type FileProtectionType =
  | 'NSFileProtectionNone'
  | 'NSFileProtectionComplete'
  | 'NSFileProtectionCompleteUnlessOpen'
  | 'NSFileProtectionCompleteUntilFirstUserAuthentication';

// Placeholder for options, can be expanded later
export interface MkdirOptions {
  // e.g., NSURLIsExcludedFromBackupKey for iOS
  excludedFromBackup?: boolean;
  fileProtection?: FileProtectionType; // iOS only, maps to NSFileProtectionKey
}

// For getFSInfo
export interface FSInfoResult {
  totalSpace: number; // in bytes
  freeSpace: number; // in bytes
}

// For downloadFile
export interface DownloadFileOptions {
  fromUrl: string;
  toFile: string;
  jobId: number;
  background?: boolean; // iOS only: Continue the download in the background after the app terminates
  discretionary?: boolean; // iOS only: Allow OS to control timing/speed for perceived performance
  cacheable?: boolean; // iOS only: Whether the download can be stored in the shared NSURLCache
  progressInterval?: number;
  progressDivider?: number;
  resumable?: boolean; // iOS only: Whether the download is resumable
  connectionTimeout?: number; // Android only: Connection timeout in ms
  readTimeout?: number; // Android/iOS: Read timeout in ms
  backgroundTimeout?: number; // iOS only: Max time (ms) to download resource in background
}

export type DownloadEventResult = {
  // This is the payload for a download completion event
  jobId: number; // jobId is a number (double) for cross-platform compatibility
  headers?: AnyMap;
  contentLength?: number;
  statusCode?: number;
  bytesWritten?: number;
  error?: string;
};

// Define the new type for hash algorithm
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512';

export interface Fs2 extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Path Constants
  readonly cachesDirectoryPath: string;
  readonly externalCachesDirectoryPath: string; // Android only
  readonly documentDirectoryPath: string;
  readonly downloadDirectoryPath: string; // Android only
  readonly externalDirectoryPath: string; // Android only
  readonly externalStorageDirectoryPath: string; // Android only
  readonly temporaryDirectoryPath: string;
  readonly libraryDirectoryPath: string; // iOS only
  readonly picturesDirectoryPath: string;

  // File System Operations
  mkdir(filepath: string, options?: MkdirOptions): Promise<void>;
  moveFile(filepath: string, destPath: string): Promise<void>;
  copyFile(filepath: string, destPath: string): Promise<void>;
  unlink(filepath: string): Promise<void>;
  exists(filepath: string): Promise<boolean>;
  readDir(dirPath: string): Promise<ReadDirItem[]>;
  readFile(filepath: string): Promise<ArrayBuffer>;
  read(
    filepath: string,
    length: number,
    position: number
  ): Promise<ArrayBuffer>;
  writeFile(filepath: string, data: ArrayBuffer): Promise<void>;
  appendFile(filepath: string, data: ArrayBuffer): Promise<void>;
  write(filepath: string, data: ArrayBuffer, position?: number): Promise<void>;
  stat(filepath: string): Promise<NativeStatResult>;
  hash(filepath: string, algorithm: HashAlgorithm): Promise<string>;
  touch(filepath: string, mtime?: number, ctime?: number): Promise<void>;

  // Device/System Information
  getFSInfo(): Promise<FSInfoResult>;

  // Download Functionality
  /**
   * Returns a jobId. Events will be used for progress and completion (carrying DownloadResult).
   * jobId must always be provided from JS for download tracking and event handling.
   */
  downloadFile(
    options: DownloadFileOptions,
    headers?: Record<string, string>
  ): Promise<number>;
  stopDownload(jobId: number): Promise<void>;
  resumeDownload(jobId: number): Promise<void>; // iOS only
  isResumable(jobId: number): Promise<boolean>; // iOS only

  /**
   * Separate download listeners as the generated nitrogen code
   * is too complext for swift parser to parse (Mangling issue)
   * Each returns an unsubscribe function.
   */
  listenToDownloadBegin(
    onDownloadBegin?: (event: DownloadEventResult) => void
  ): () => void;
  listenToDownloadProgress(
    onDownloadProgress?: (event: DownloadEventResult) => void
  ): () => void;
  listenToDownloadComplete(
    onDownloadComplete?: (result: DownloadEventResult) => void
  ): () => void;
  listenToDownloadError(
    onDownloadError?: (event: DownloadEventResult) => void
  ): () => void;

  /**
   * iOS only: Called when a download becomes resumable (can be resumed, e.g. after pause/interruption). No-op on Android.
   * Returns an unsubscribe function.
   */
  listenToDownloadCanBeResumed(
    onDownloadCanBeResumed?: (event: DownloadEventResult) => void
  ): () => void;

  // Android Specific Functionality
  getAllExternalFilesDirs(): Promise<string[]>; // Android only
  scanFile(path: string): Promise<string[]>; // Android only (Triggers Media Scanner)
}
