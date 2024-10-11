export type MkdirOptions = {
  NSURLIsExcludedFromBackupKey?: boolean; // iOS only
  NSFileProtectionKey?: string; // iOS only
};

export type FileOptions = {
  NSFileProtectionKey?: string; // iOS only
};

export type ReadDirItem = {
  ctime: Date | undefined; // The creation date of the file (iOS only)
  mtime: Date | undefined; // The last modified date of the file
  name: string; // The name of the item
  path: string; // The absolute path to the item
  size: number; // Size in bytes
  isFile: () => boolean; // Is the file just a file?
  isDirectory: () => boolean; // Is the file a directory?
};

export type StatResult = {
  type: any; // TODO
  name: string | undefined; // The name of the item
  path: string; // The absolute path to the item
  size: number; // Size in bytes
  mode: number; // UNIX file mode
  ctime: number; // Created date
  mtime: number; // Last modified date
  originalFilepath: string; // In case of content uri this is the pointed file path, otherwise is the same as path
  isFile: () => boolean; // Is the file just a file?
  isDirectory: () => boolean; // Is the file a directory?
};

export type Headers = { [name: string]: string };
export type Fields = { [name: string]: string };

export type DownloadFileOptions = {
  fromUrl: string; // URL to download file from
  toFile: string; // Local filesystem path to save the file to
  headers?: Headers; // An object of headers to be passed to the server
  background?: boolean; // Continue the download in the background after the app terminates (iOS only)
  discretionary?: boolean; // Allow the OS to control the timing and speed of the download to improve perceived performance  (iOS only)
  cacheable?: boolean; // Whether the download can be stored in the shared NSURLCache (iOS only)
  progressInterval?: number;
  progressDivider?: number;
  begin?: (res: DownloadBeginCallbackResult) => void; // Note: it is required when progress prop provided
  progress?: (res: DownloadProgressCallbackResult) => void;
  resumable?: () => void; // only supported on iOS
  connectionTimeout?: number; // only supported on Android
  readTimeout?: number; // supported on Android and iOS
  backgroundTimeout?: number; // Maximum time (in milliseconds) to download an entire resource (iOS only, useful for timing out background downloads)
};

export type DownloadBeginCallbackResult = {
  jobId: number; // The download jobId, required if one wishes to cancel the download. See `stopDownload`.
  statusCode: number; // The HTTP status code
  contentLength: number; // The total size in bytes of the download resource
  headers: Headers; // The HTTP response headers from the server
};

export type DownloadProgressCallbackResult = {
  jobId: number; // The download jobId, required if one wishes to cancel the download. See `stopDownload`.
  contentLength: number; // The total size in bytes of the download resource
  bytesWritten: number; // The number of bytes written to the file so far
};

export type DownloadResult = {
  jobId: number; // The download jobId, required if one wishes to cancel the download. See `stopDownload`.
  statusCode: number; // The HTTP status code
  bytesWritten: number; // The number of bytes written to the file
};

export type DownloadFileResult = {
  jobId: number;
  promise: Promise<DownloadResult>;
};

export type FSInfoResult = {
  totalSpace: number; // The total amount of storage space on the device (in bytes).
  freeSpace: number; // The amount of available storage space on the device (in bytes).
};

export type FileDescriptor = {
  name: string;
  parentFolder: string;
  mimeType: string;
};

export type MediaStoreSearchOptions = {
  uri: string;
  fileName: string;
  relativePath: string;
  mediaType: MediaCollections;
};

export type MediaStoreQueryResult = {
  contentUri: string;
};

export type Encoding = 'utf8' | 'base64' | 'ascii' | 'arraybuffer';
export type EncodingOrOptions = Encoding | Record<string, any>;
export type ProcessedOptions = Record<string, any | Encoding>;
export type MediaCollections = 'Audio' | 'Image' | 'Video' | 'Download';
