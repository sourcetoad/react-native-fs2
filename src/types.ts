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
