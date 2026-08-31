import type {
  DownloadFileOptions as DownloadFileOptionsNitro,
  DownloadEventResult,
  FileOptions,
} from './nitro/Fs2.nitro';
import type {
  ReadStreamOptions as ReadStreamOptionsNitro,
  WriteStreamOptions as WriteStreamOptionsNitro,
  ReadStreamDataEvent as ReadStreamDataEventNitro,
  ReadStreamProgressEvent as ReadStreamProgressEventNitro,
  ReadStreamEndEvent as ReadStreamEndEventNitro,
  WriteStreamProgressEvent as WriteStreamProgressEventNitro,
  WriteStreamFinishEvent as WriteStreamFinishEventNitro,
} from './nitro/Fs2Stream.nitro';

export type Encoding = 'utf8' | 'ascii' | 'base64' | 'arraybuffer';
// `fileProtection` rides alongside the encoding rather than in a parameter of its own,
// because that is where 3.x put NSFileProtectionKey (master:src/index.ts:264-268). It is
// read by writeFile only; the other readers ignore it.
export type EncodingOrOptions =
  | Encoding
  | ({ encoding?: Encoding } & FileOptions);

/**
 * A `readDir` entry.
 *
 * `isFile`/`isDirectory` are accessors rather than plain booleans so that this matches
 * `StatResult` and the 3.x API. The Nitro struct the native layer returns
 * (`NativeReadDirItem`) carries them as booleans; `readDir` wraps them.
 */
export type ReadDirItem = {
  name: string; // The name of the item
  path: string; // The absolute path to the item
  size: number; // Size in bytes
  mtime: number; // Last modified, ms since epoch
  ctime?: number; // Created, ms since epoch. Best effort: iOS provides it, Android omits it here
  isFile: () => boolean; // Is the item just a file?
  isDirectory: () => boolean; // Is the item a directory?
};

/**
 * Options accepted by `RNFS.downloadFile`.
 *
 * This is the consumer-facing shape, not the Nitro struct:
 *
 * - `jobId` is omitted. The wrapper allocates one and returns it alongside the promise, so
 *   requiring callers to supply it made `downloadFile({ fromUrl, toFile })` - the 3.x call -
 *   a type error.
 * - `headers` lives here even though the Nitro method takes it as a separate argument. The
 *   wrapper splits it back out.
 * - The event callbacks are registered as Nitro listeners rather than forwarded natively.
 */
export type DownloadFileOptions = Omit<DownloadFileOptionsNitro, 'jobId'> & {
  headers?: Record<string, string>; // Request headers to send to the server
  begin?: (event: DownloadEventResult) => void;
  progress?: (event: DownloadEventResult) => void;
  complete?: (event: DownloadEventResult) => void;
  error?: (event: DownloadEventResult) => void;
  canBeResumed?: (event: DownloadEventResult) => void; // iOS only
};

/**
 * What `downloadFile().promise` resolves to.
 *
 * `statusCode`/`bytesWritten` are optional, unlike 3.x which declared them required. That
 * declaration was wrong even on 3.x - its iOS native only attached each key when the value was
 * non-nil (master:ios/RNFSManager.m:501-508) - and a download stopped through `stopDownload()`
 * settles with neither.
 */
export type DownloadResult = {
  jobId: number;
  statusCode?: number;
  bytesWritten?: number;
};

export type DownloadFileResult = {
  jobId: number;
  promise: Promise<DownloadResult>;
};

export type StatResult = {
  type?: any; // TODO
  name?: string; // The name of the item
  path: string; // The absolute path to the item
  size: number; // Size in bytes
  mode: number; // UNIX file mode
  ctime: number; // Created, ms since epoch
  mtime: number; // Last modified, ms since epoch
  originalFilepath: string; // In case of content uri this is the pointed file path, otherwise is the same as path
  isFile: () => boolean; // Is the file just a file?
  isDirectory: () => boolean; // Is the file a directory?
};

export interface ReadStreamOptions {
  bufferSize?: number;
  start?: number;
  end?: number;
}

export interface WriteStreamOptions {
  append?: boolean;
  bufferSize?: number;
  createDirectories?: boolean;
}

// Stream event types
export interface ReadStreamDataEvent {
  streamId: string;
  data: ArrayBuffer;
  chunk: number;
  position: number;
}

export interface ReadStreamProgressEvent {
  streamId: string;
  bytesRead: number;
  totalBytes: number;
  progress: number;
}

export interface ReadStreamEndEvent {
  streamId: string;
  bytesRead: number;
  success: boolean;
}

export interface WriteStreamProgressEvent {
  streamId: string;
  bytesWritten: number;
  lastChunkSize: number;
}

export interface WriteStreamFinishEvent {
  streamId: string;
  bytesWritten: number;
  success: boolean;
}

export type DataEventPlain =
  | ReadStreamDataEvent
  | ReadStreamProgressEvent
  | ReadStreamEndEvent
  | WriteStreamProgressEvent
  | WriteStreamFinishEvent;

export type DataEventNitro =
  | ReadStreamDataEventNitro
  | ReadStreamProgressEventNitro
  | ReadStreamEndEventNitro
  | WriteStreamProgressEventNitro
  | WriteStreamFinishEventNitro;

export type StreamOptionPlain = ReadStreamOptions | WriteStreamOptions;

export type StreamOptionNitro =
  | ReadStreamOptionsNitro
  | WriteStreamOptionsNitro;
