import type { HybridObject } from 'react-native-nitro-modules';

// Stream related types - using same encoding as main API
import type { Encoding } from '../types';
export type StreamEncoding = Encoding;

export interface ReadStreamOptions {
  bufferSize?: number;
  encoding?: StreamEncoding;
  start?: bigint;
  end?: bigint;
}

export interface WriteStreamOptions {
  append?: boolean;
  encoding?: StreamEncoding;
  bufferSize?: number;
  createDirectories?: boolean;
}

export interface ReadStreamHandle {
  streamId: string;
}

export interface WriteStreamHandle {
  streamId: string;
}

// Stream event types
export interface ReadStreamDataEvent {
  streamId: string;
  data: ArrayBuffer;
  chunk: bigint;
  position: bigint;
  encoding: StreamEncoding;
}

export interface ReadStreamProgressEvent {
  streamId: string;
  bytesRead: bigint;
  totalBytes: bigint;
  progress: number;
}

export interface ReadStreamEndEvent {
  streamId: string;
  bytesRead: bigint;
  success: boolean;
}

export interface ReadStreamErrorEvent {
  streamId: string;
  error: string;
  code?: string;
}

export interface WriteStreamProgressEvent {
  streamId: string;
  bytesWritten: bigint;
  lastChunkSize: bigint;
}

export interface WriteStreamFinishEvent {
  streamId: string;
  bytesWritten: bigint;
  success: boolean;
}

export interface WriteStreamErrorEvent {
  streamId: string;
  error: string;
  code?: string;
}

export interface Fs2Stream
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // File Stream APIs
  createReadStream(
    path: string,
    options?: ReadStreamOptions
  ): Promise<ReadStreamHandle>;
  createWriteStream(
    path: string,
    options?: WriteStreamOptions
  ): Promise<WriteStreamHandle>;

  // Read Stream Control
  startReadStream(streamId: string): Promise<void>;
  pauseReadStream(streamId: string): Promise<void>;
  resumeReadStream(streamId: string): Promise<void>;
  closeReadStream(streamId: string): Promise<void>;
  isReadStreamActive(streamId: string): Promise<boolean>;

  // Write Stream Control
  writeToStream(streamId: string, data: ArrayBuffer): Promise<void>;
  writeStringToStream(streamId: string, data: string): Promise<void>;
  flushWriteStream(streamId: string): Promise<void>;
  closeWriteStream(streamId: string): Promise<void>;
  isWriteStreamActive(streamId: string): Promise<boolean>;
  getWriteStreamPosition(streamId: string): Promise<bigint>;

  // Stream Event Listeners
  listenToReadStreamData(
    streamId: string,
    onData: (event: ReadStreamDataEvent) => void
  ): () => void;
  listenToReadStreamProgress(
    streamId: string,
    onProgress: (event: ReadStreamProgressEvent) => void
  ): () => void;
  listenToReadStreamEnd(
    streamId: string,
    onEnd: (event: ReadStreamEndEvent) => void
  ): () => void;
  listenToReadStreamError(
    streamId: string,
    onError: (event: ReadStreamErrorEvent) => void
  ): () => void;

  listenToWriteStreamProgress(
    streamId: string,
    onProgress: (event: WriteStreamProgressEvent) => void
  ): () => void;
  listenToWriteStreamFinish(
    streamId: string,
    onFinish: (event: WriteStreamFinishEvent) => void
  ): () => void;
  listenToWriteStreamError(
    streamId: string,
    onError: (event: WriteStreamErrorEvent) => void
  ): () => void;
}
