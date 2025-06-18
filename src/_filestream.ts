import { NitroModules } from 'react-native-nitro-modules';
import type { Fs2Stream } from './nitro/Fs2Stream.nitro';
import type {
  ReadStreamHandle as ReadStreamHandleNitro,
  WriteStreamHandle as WriteStreamHandleNitro,
  ReadStreamDataEvent as ReadStreamDataEventNitro,
  ReadStreamProgressEvent as ReadStreamProgressEventNitro,
  ReadStreamEndEvent as ReadStreamEndEventNitro,
  ReadStreamErrorEvent,
  WriteStreamProgressEvent as WriteStreamProgressEventNitro,
  WriteStreamFinishEvent as WriteStreamFinishEventNitro,
  WriteStreamErrorEvent,
} from './nitro/Fs2Stream.nitro';
import {
  normalizeFilePath,
  encodeContents,
  decodeContents,
  convertFs2StreamOptionsToNitroOptions,
  convertFs2StreamEventResultsToNitro,
  convertFs2StreamEventResultsToPlain,
} from './utils';
import type {
  Encoding,
  ReadStreamOptions,
  WriteStreamOptions,
  ReadStreamDataEvent,
  ReadStreamProgressEvent,
  ReadStreamEndEvent,
  WriteStreamProgressEvent,
  WriteStreamFinishEvent,
} from './types';

/**
 * Re-export stream types for external use
 */
export type {
  ReadStreamErrorEvent,
  WriteStreamErrorEvent,
} from './nitro/Fs2Stream.nitro';

export type {
  ReadStreamOptions,
  WriteStreamOptions,
  ReadStreamDataEvent,
  ReadStreamProgressEvent,
  ReadStreamEndEvent,
  WriteStreamProgressEvent,
  WriteStreamFinishEvent,
} from './types';

// Re-export standard encoding type for convenience
export type { Encoding } from './types';

/**
 * Get the Nitro module instance for stream functionality
 */
const RNFS2StreamNitro =
  NitroModules.createHybridObject<Fs2Stream>('Fs2Stream');

/**
 * Enhanced ReadStreamHandle with control methods
 */
export interface ExtendedReadStreamHandle extends ReadStreamHandleNitro {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
  isActive(): Promise<boolean>;
}

/**
 * Enhanced WriteStreamHandle with control methods
 */
export interface ExtendedWriteStreamHandle extends WriteStreamHandleNitro {
  write(data: ArrayBuffer): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  isActive(): Promise<boolean>;
  getPosition(): Promise<number>;
  end(): Promise<void>;
}

async function getWriteStreamPositionAsNumber(
  streamId: string
): Promise<number> {
  const pos = await RNFS2StreamNitro.getWriteStreamPosition(streamId);
  return Number(pos);
}

/**
 * Create a read stream for efficiently reading large files in chunks
 */
export async function createReadStream(
  path: string,
  options?: ReadStreamOptions
): Promise<ExtendedReadStreamHandle> {
  const normalizedPath = normalizeFilePath(path);

  const handle = await RNFS2StreamNitro.createReadStream(
    normalizedPath,
    convertFs2StreamOptionsToNitroOptions(options ?? {})
  );

  return {
    ...handle,
    start: () => RNFS2StreamNitro.startReadStream(handle.streamId),
    pause: () => RNFS2StreamNitro.pauseReadStream(handle.streamId),
    resume: () => RNFS2StreamNitro.resumeReadStream(handle.streamId),
    close: () => RNFS2StreamNitro.closeReadStream(handle.streamId),
    isActive: () => RNFS2StreamNitro.isReadStreamActive(handle.streamId),
  };
}

/**
 * Create a write stream for efficiently writing large files in chunks
 */
export async function createWriteStream(
  path: string,
  options?: WriteStreamOptions
): Promise<ExtendedWriteStreamHandle> {
  const normalizedPath = normalizeFilePath(path);
  const handle = await RNFS2StreamNitro.createWriteStream(
    normalizedPath,
    convertFs2StreamOptionsToNitroOptions(options ?? {})
  );

  return {
    ...handle,
    write: (data: ArrayBuffer) =>
      RNFS2StreamNitro.writeToStream(handle.streamId, data),
    flush: () => RNFS2StreamNitro.flushWriteStream(handle.streamId),
    close: () => RNFS2StreamNitro.closeWriteStream(handle.streamId),
    isActive: () => RNFS2StreamNitro.isWriteStreamActive(handle.streamId),
    getPosition: () => getWriteStreamPositionAsNumber(handle.streamId),
    end: () => RNFS2StreamNitro.endWriteStream(handle.streamId),
  };
}

/**
 * Listen for data chunks from a read stream
 */
export function listenToReadStreamData(
  streamId: string,
  onData: (event: ReadStreamDataEvent) => void
): () => void {
  const onDataNitro = (event: ReadStreamDataEventNitro) => {
    const eventPlain = convertFs2StreamEventResultsToPlain(event);

    onData(eventPlain as ReadStreamDataEvent);
  };

  return RNFS2StreamNitro.listenToReadStreamData(streamId, onDataNitro);
}

/**
 * Listen for progress updates from a read stream
 */
export function listenToReadStreamProgress(
  streamId: string,
  onProgress: (event: ReadStreamProgressEvent) => void
): () => void {
  const onProgressNitro = (event: ReadStreamProgressEventNitro) => {
    const eventPlain = convertFs2StreamEventResultsToPlain(event);
    onProgress(eventPlain as ReadStreamProgressEvent);
  };

  return RNFS2StreamNitro.listenToReadStreamProgress(streamId, onProgressNitro);
}

/**
 * Listen for read stream completion
 */
export function listenToReadStreamEnd(
  streamId: string,
  onEnd: (event: ReadStreamEndEvent) => void
): () => void {
  const onEndNitro = (event: ReadStreamEndEventNitro) => {
    const eventPlain = convertFs2StreamEventResultsToPlain(event);
    onEnd(eventPlain as ReadStreamEndEvent);
  };

  return RNFS2StreamNitro.listenToReadStreamEnd(streamId, onEndNitro);
}

/**
 * Listen for read stream errors
 */
export function listenToReadStreamError(
  streamId: string,
  onError: (event: ReadStreamErrorEvent) => void
): () => void {
  return RNFS2StreamNitro.listenToReadStreamError(streamId, onError);
}

/**
 * Listen for write stream progress
 */
export function listenToWriteStreamProgress(
  streamId: string,
  onProgress: (event: WriteStreamProgressEvent) => void
): () => void {
  const onProgressNitro = (event: WriteStreamProgressEventNitro) => {
    const eventPlain = convertFs2StreamEventResultsToPlain(event);
    onProgress(eventPlain as WriteStreamProgressEvent);
  };

  return RNFS2StreamNitro.listenToWriteStreamProgress(
    streamId,
    onProgressNitro
  );
}

/**
 * Listen for write stream completion
 */
export function listenToWriteStreamFinish(
  streamId: string,
  onFinish: (event: WriteStreamFinishEvent) => void
): () => void {
  const onFinishNitro = (event: WriteStreamFinishEventNitro) => {
    const eventPlain = convertFs2StreamEventResultsToPlain(event);
    onFinish(eventPlain as WriteStreamFinishEvent);
  };

  return RNFS2StreamNitro.listenToWriteStreamFinish(streamId, onFinishNitro);
}

/**
 * Listen for write stream errors
 */
export function listenToWriteStreamError(
  streamId: string,
  onError: (event: WriteStreamErrorEvent) => void
): () => void {
  return RNFS2StreamNitro.listenToWriteStreamError(streamId, onError);
}

/**
 * Utility function to convert ArrayBuffer to string based on encoding
 */
export function arrayBufferToString(
  buffer: ArrayBuffer,
  encoding: Encoding = 'utf8'
): string {
  const result = decodeContents(buffer, encoding);
  if (typeof result === 'string') {
    return result;
  }
  throw new Error(
    'Cannot convert ArrayBuffer to string with arraybuffer encoding'
  );
}

/**
 * Utility function to convert string to ArrayBuffer based on encoding
 */
export function stringToArrayBuffer(
  str: string,
  encoding: Encoding = 'utf8'
): ArrayBuffer {
  return encodeContents(str, encoding);
}

/**
 * Utility function to concatenate ArrayBuffers
 */
export function concatenateArrayBuffers(
  buffer1: ArrayBuffer,
  buffer2: ArrayBuffer
): ArrayBuffer {
  const combined = new ArrayBuffer(buffer1.byteLength + buffer2.byteLength);
  const view = new Uint8Array(combined);
  view.set(new Uint8Array(buffer1), 0);
  view.set(new Uint8Array(buffer2), buffer1.byteLength);
  return combined;
}

/**
 * High-level utility function to read a file as text or binary using streams
 */
export async function readStream(
  filePath: string,
  encoding: Encoding = 'arraybuffer'
): Promise<string | ArrayBuffer> {
  const stream = await createReadStream(filePath, { bufferSize: 128 });
  let content: string | ArrayBuffer =
    encoding === 'arraybuffer' ? new ArrayBuffer(0) : '';

  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    const unsubscribeData = listenToReadStreamData(stream.streamId, (event) => {
      if (encoding === 'arraybuffer') {
        // Concatenate ArrayBuffers
        content = concatenateArrayBuffers(content as ArrayBuffer, event.data);
      } else {
        // Decode chunk and append to string
        const chunk = decodeContents(event.data, encoding);
        if (typeof chunk !== 'string') {
          reject(new Error('Failed to decode chunk as string'));
          return;
        }
        content += chunk;
      }
    });

    const unsubscribeEnd = listenToReadStreamEnd(stream.streamId, () => {
      unsubscribeData();
      unsubscribeEnd();
      resolve(content);
    });

    const unsubscribeError = listenToReadStreamError(
      stream.streamId,
      (event) => {
        unsubscribeData();
        unsubscribeEnd();
        unsubscribeError();
        reject(new Error(event.error));
      }
    );

    stream.start().catch(reject);
  });
}

/**
 * High-level utility function to write text or binary using streams
 */
export async function writeStream(
  filePath: string,
  data: string | ArrayBuffer,
  encoding: Encoding = 'arraybuffer'
): Promise<void> {
  const stream = await createWriteStream(filePath);

  return new Promise<void>((resolve, reject) => {
    const unsubscribeFinish = listenToWriteStreamFinish(stream.streamId, () => {
      unsubscribeFinish();
      resolve();
    });

    const unsubscribeError = listenToWriteStreamError(
      stream.streamId,
      (event) => {
        unsubscribeFinish();
        unsubscribeError();
        reject(new Error(event.error));
      }
    );

    // Encode if needed
    const buffer =
      typeof data === 'string' ? encodeContents(data, encoding) : data;
    stream
      .write(buffer)
      .then(() => stream.end())
      .catch(reject);
  });
}

/**
 * High-level utility function to copy a file using streams with progress
 */
export async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  options: {
    bufferSize?: number;
    onProgress?: (progress: number) => void;
  } = {}
): Promise<void> {
  const { bufferSize = 16384, onProgress } = options;

  const readStream = await createReadStream(sourcePath, { bufferSize });
  const writeStream = await createWriteStream(destPath, { bufferSize });

  return new Promise<void>((resolve, reject) => {
    let unsubscribeData: (() => void) | null = null;
    let unsubscribeProgress: (() => void) | null = null;
    let unsubscribeEnd: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;

    const cleanup = () => {
      unsubscribeData?.();
      unsubscribeProgress?.();
      unsubscribeEnd?.();
      unsubscribeError?.();
    };

    // Forward read data to write stream
    unsubscribeData = listenToReadStreamData(
      readStream.streamId,
      async (event) => {
        try {
          await writeStream.write(event.data);
        } catch (error) {
          cleanup();
          reject(error);
        }
      }
    );

    // Track progress
    if (onProgress) {
      unsubscribeProgress = listenToReadStreamProgress(
        readStream.streamId,
        (event) => {
          onProgress(event.progress);
        }
      );
    }

    // Handle completion
    unsubscribeEnd = listenToReadStreamEnd(readStream.streamId, async () => {
      try {
        await writeStream.close();
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    // Handle errors
    unsubscribeError = listenToReadStreamError(readStream.streamId, (event) => {
      cleanup();
      reject(new Error(event.error));
    });

    // Start the copy
    readStream.start().catch(reject);
  });
}

/**
 * Stream-based file reading with chunk processing
 */
export async function processFileInChunks(
  filePath: string,
  chunkProcessor: (
    chunk: ArrayBuffer,
    chunkIndex: bigint,
    position: bigint
  ) => Promise<void> | void,
  options: ReadStreamOptions = {}
): Promise<void> {
  const stream = await createReadStream(filePath, options);

  return new Promise<void>((resolve, reject) => {
    const unsubscribeData = listenToReadStreamData(
      stream.streamId,
      async (event) => {
        const eventNitro = convertFs2StreamEventResultsToNitro(
          event
        ) as ReadStreamDataEventNitro;

        try {
          await chunkProcessor(
            eventNitro.data,
            eventNitro.chunk,
            eventNitro.position
          );
        } catch (error) {
          unsubscribeData();
          unsubscribeEnd();
          unsubscribeError();
          reject(error);
        }
      }
    );

    const unsubscribeEnd = listenToReadStreamEnd(stream.streamId, () => {
      unsubscribeData();
      unsubscribeEnd();
      resolve();
    });

    const unsubscribeError = listenToReadStreamError(
      stream.streamId,
      (event) => {
        unsubscribeData();
        unsubscribeEnd();
        unsubscribeError();
        reject(new Error(event.error));
      }
    );

    stream.start().catch(reject);
  });
}
