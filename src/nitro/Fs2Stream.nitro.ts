import type { HybridObject, Int64 } from 'react-native-nitro-modules';

export interface ReadStreamOptions {
  bufferSize?: number;
  start?: Int64;
  end?: Int64;
}

export interface WriteStreamOptions {
  append?: boolean;
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
  chunk: Int64;
  position: Int64;
}

export interface ReadStreamProgressEvent {
  streamId: string;
  bytesRead: Int64;
  totalBytes: Int64;
  progress: number;
}

export interface ReadStreamEndEvent {
  streamId: string;
  bytesRead: Int64;
  success: boolean;
}

export interface ReadStreamErrorEvent {
  streamId: string;
  error: string;
  code?: string;
}

export interface WriteStreamProgressEvent {
  streamId: string;
  bytesWritten: Int64;
  lastChunkSize: Int64;
}

export interface WriteStreamFinishEvent {
  streamId: string;
  bytesWritten: Int64;
  success: boolean;
}

export interface WriteStreamErrorEvent {
  streamId: string;
  error: string;
  code?: string;
}

export interface Fs2Stream extends HybridObject<{
  ios: 'swift';
  android: 'kotlin';
}> {
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
  flushWriteStream(streamId: string): Promise<void>;
  closeWriteStream(streamId: string): Promise<void>;
  isWriteStreamActive(streamId: string): Promise<boolean>;
  getWriteStreamPosition(streamId: string): Promise<Int64>;
  endWriteStream(streamId: string): Promise<void>;

  // Stream Event Listeners
  listenToReadStreamData(
    streamId: string,
    /**
     * Awaited by the native read loop before the next chunk is read - this is the read
     * path's back-pressure. The resolved value is ignored; it is `boolean` rather than
     * `void` because Nitro 0.37 resolves a Kotlin `Promise<Unit>` from C++ with a bare
     * `java.lang.Object` (`JUnit::instance()`), which throws `ClassCastException` inside
     * `JPromise::resolve` while it holds its mutex - wedging the promise for good.
     */
    onData: (event: ReadStreamDataEvent) => Promise<boolean>
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
