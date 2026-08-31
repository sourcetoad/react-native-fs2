import type {
  DownloadFileOptions as DownloadFileOptionsNitro,
  DownloadEventResult,
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
export type EncodingOrOptions = Encoding | { encoding?: Encoding };

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
  mtime: number; // Last modified date
  ctime?: number; // Created date (best effort; iOS provides it, Android reuses mtime)
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

export type StatResult = {
  type?: any; // TODO
  name?: string; // The name of the item
  path: string; // The absolute path to the item
  size: number; // Size in bytes
  mode: number; // UNIX file mode
  ctime: number; // Created date
  mtime: number; // Last modified date
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
