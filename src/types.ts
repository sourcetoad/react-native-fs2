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
  begin?: (res: DownloadBeginCallbackResult) => void;
  progress?: (res: DownloadProgressCallbackResult) => void;
  resumable?: () => void; // only supported on iOS yet
  connectionTimeout?: number; // only supported on Android yet
  readTimeout?: number; // supported on Android and iOS
  backgroundTimeout?: number; // Maximum time (in milliseconds) to download an entire resource (iOS only, useful for timing out background downloads)
};

export type DownloadBeginCallbackResult = {
  jobId: number; // The download job ID, required if one wishes to cancel the download. See `stopDownload`.
  statusCode: number; // The HTTP status code
  contentLength: number; // The total size in bytes of the download resource
  headers: Headers; // The HTTP response headers from the server
};

export type DownloadProgressCallbackResult = {
  jobId: number; // The download job ID, required if one wishes to cancel the download. See `stopDownload`.
  contentLength: number; // The total size in bytes of the download resource
  bytesWritten: number; // The number of bytes written to the file so far
};

export type DownloadResult = {
  jobId: number; // The download job ID, required if one wishes to cancel the download. See `stopDownload`.
  statusCode: number; // The HTTP status code
  bytesWritten: number; // The number of bytes written to the file
};

export type UploadFileOptions = {
  toUrl: string; // URL to upload file to
  binaryStreamOnly?: boolean; // Allow for binary data stream for file to be uploaded without extra headers, Default is 'false'
  files: UploadFileItem[]; // An array of objects with the file information to be uploaded.
  headers?: Headers; // An object of headers to be passed to the server
  fields?: Fields; // An object of fields to be passed to the server
  method?: string; // Default is 'POST', supports 'POST' and 'PUT'
  beginCallback?: (res: UploadBeginCallbackResult) => void; // deprecated
  progressCallback?: (res: UploadProgressCallbackResult) => void; // deprecated
  begin?: (res: UploadBeginCallbackResult) => void;
  progress?: (res: UploadProgressCallbackResult) => void;
};

export type UploadFileItem = {
  name: string; // Name of the file, if not defined then filename is used
  filename: string; // Name of file
  filepath: string; // Path to file
  filetype: string; // The mimetype of the file to be uploaded, if not defined it will get mimetype from `filepath` extension
};

export type UploadBeginCallbackResult = {
  jobId: number; // The upload job ID, required if one wishes to cancel the upload. See `stopUpload`.
};

export type UploadProgressCallbackResult = {
  jobId: number; // The upload job ID, required if one wishes to cancel the upload. See `stopUpload`.
  totalBytesExpectedToSend: number; // The total number of bytes that will be sent to the server
  totalBytesSent: number; // The number of bytes sent to the server
};

export type FSInfoResult = {
  totalSpace: number; // The total amount of storage space on the device (in bytes).
  freeSpace: number; // The amount of available storage space on the device (in bytes).
};

export type Encoding = 'utf8' | 'base64' | 'ascii';
export type EncodingOrOptions = Encoding | Record<string, any>;
export type ProcessedOptions = Record<string, any | Encoding>;
