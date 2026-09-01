/**
 * File Streaming API.
 *
 * @beta Every export in this module is beta and may change without a major version bump.
 */
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

const MAX_STREAM_BUFFER_SIZE = 16 * 1024 * 1024;

/**
 * Rejects option values native cannot survive: `bufferSize` reaches an allocation and a read
 * length unchecked on both platforms, and a negative `start` traps on iOS.
 */
function validateStreamOptions(
  options: ReadStreamOptions | WriteStreamOptions | undefined
): void {
  if (!options) return;

  const { bufferSize } = options;
  if (bufferSize !== undefined) {
    if (!Number.isInteger(bufferSize)) {
      throw new Error(
        `EINVAL: bufferSize must be a positive integer, got ${bufferSize}`
      );
    }
    if (bufferSize <= 0 || bufferSize > MAX_STREAM_BUFFER_SIZE) {
      throw new Error(
        `EINVAL: bufferSize must be between 1 and ${MAX_STREAM_BUFFER_SIZE}, got ${bufferSize}`
      );
    }
  }

  const { start, end } = options as ReadStreamOptions;
  if (start !== undefined) {
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(
        `EINVAL: start must be a non-negative integer, got ${start}`
      );
    }
  }
  if (end !== undefined) {
    if (!Number.isInteger(end) || end < 0) {
      throw new Error(`EINVAL: end must be a non-negative integer, got ${end}`);
    }
    if (start !== undefined && end < start) {
      throw new Error(
        `EINVAL: end (${end}) must not be before start (${start})`
      );
    }
  }
}

/**
 * Create a read stream for efficiently reading large files in chunks
 *
 * @beta
 */
export async function createReadStream(
  path: string,
  options?: ReadStreamOptions
): Promise<ExtendedReadStreamHandle> {
  validateStreamOptions(options);
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
 *
 * @beta
 */
export async function createWriteStream(
  path: string,
  options?: WriteStreamOptions
): Promise<ExtendedWriteStreamHandle> {
  validateStreamOptions(options);
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
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
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
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
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
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
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
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
 */
export function listenToReadStreamError(
  streamId: string,
  onError: (event: ReadStreamErrorEvent) => void
): () => void {
  return RNFS2StreamNitro.listenToReadStreamError(streamId, onError);
}

/**
 * Listen for write stream progress
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
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
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
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
 *
 * Only one subscriber per (stream, event) is supported: registering a second callback for
 * the same stream replaces the first, and either returned unsubscribe removes whichever is
 * currently installed. In particular, do not subscribe to a stream that
 * `copyFileWithProgress` or `processFileInChunks` is already driving.
 *
 * @beta
 */
export function listenToWriteStreamError(
  streamId: string,
  onError: (event: WriteStreamErrorEvent) => void
): () => void {
  return RNFS2StreamNitro.listenToWriteStreamError(streamId, onError);
}

/**
 * Utility function to convert ArrayBuffer to string based on encoding
 *
 * @beta
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
 *
 * @beta
 */
export function stringToArrayBuffer(
  str: string,
  encoding: Encoding = 'utf8'
): ArrayBuffer {
  return encodeContents(str, encoding);
}

/**
 * Concatenates two ArrayBuffers.
 *
 * Prefer collecting chunks in an array and calling {@link concatenateChunks} once: calling
 * this in a loop reallocates and recopies everything accumulated so far on every chunk.
 *
 * @beta
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
 * Joins chunks into one ArrayBuffer with a single allocation and a single pass.
 *
 * @beta
 */
export function concatenateChunks(chunks: ArrayBuffer[]): ArrayBuffer {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

/**
 * Default chunk size for the high-level helpers, in bytes.
 *
 * Each chunk costs one JSI callback, so a small size dominates the cost of a large read:
 * at the previous 128 bytes a 10 MB file produced ~78,000 round trips.
 */
const DEFAULT_STREAM_BUFFER_SIZE = 64 * 1024;

/**
 * How many chunks may sit un-written before the read stream is paused.
 *
 * Native does not await the data callback, so without this the reader runs ahead of the
 * writer without bound.
 */
const DEFAULT_HIGH_WATER_MARK = 8;

/**
 * Closes a stream, ignoring "no such stream".
 *
 * Native drops its registry entry when a read loop finishes on its own, so closing after
 * `end` reports an unknown stream. That is the normal path, not a failure.
 */
async function closeQuietly(stream: {
  close: () => Promise<void>;
}): Promise<void> {
  try {
    await stream.close();
  } catch {
    // Intentionally ignored - see above.
  }
}

/**
 * Reads a whole file through a stream and returns it as text or binary.
 *
 * Chunks are collected and joined once, then decoded once over the assembled buffer. Decoding
 * per chunk would corrupt any multi-byte character that straddles a chunk boundary.
 *
 * @beta
 */
export async function readStream(
  filePath: string,
  encoding: Encoding = 'arraybuffer',
  options: { bufferSize?: number } = {}
): Promise<string | ArrayBuffer> {
  const stream = await createReadStream(filePath, {
    bufferSize: options.bufferSize ?? DEFAULT_STREAM_BUFFER_SIZE,
  });

  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    const chunks: ArrayBuffer[] = [];
    let settled = false;

    let unsubscribeData: (() => void) | null = null;
    let unsubscribeEnd: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;

    const cleanup = () => {
      unsubscribeData?.();
      unsubscribeEnd?.();
      unsubscribeError?.();
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeQuietly(stream);
      reject(error);
    };

    unsubscribeData = listenToReadStreamData(stream.streamId, (event) => {
      if (settled) return;
      chunks.push(event.data);
    });

    unsubscribeEnd = listenToReadStreamEnd(stream.streamId, (event) => {
      if (settled) return;
      // `end` also fires for a stream closed mid-flight, with partial bytes.
      if (!event.success) {
        fail(new Error('Read stream ended unsuccessfully'));
        return;
      }
      settled = true;
      cleanup();
      closeQuietly(stream);

      const assembled = concatenateChunks(chunks);
      if (encoding === 'arraybuffer') {
        resolve(assembled);
        return;
      }

      try {
        const decoded = decodeContents(assembled, encoding);
        if (typeof decoded !== 'string') {
          reject(new Error('Failed to decode file contents as string'));
          return;
        }
        resolve(decoded);
      } catch (error) {
        reject(error);
      }
    });

    unsubscribeError = listenToReadStreamError(stream.streamId, (event) =>
      fail(new Error(event.error))
    );

    stream.start().catch(fail);
  });
}

/**
 * Writes text or binary to a file through a stream.
 *
 * @beta
 */
export async function writeStream(
  filePath: string,
  data: string | ArrayBuffer,
  encoding: Encoding = 'arraybuffer'
): Promise<void> {
  const stream = await createWriteStream(filePath);

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    let unsubscribeFinish: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;

    const cleanup = () => {
      unsubscribeFinish?.();
      unsubscribeError?.();
    };

    const settle = async (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      await closeQuietly(stream);
      if (error) reject(error);
      else resolve();
    };

    unsubscribeFinish = listenToWriteStreamFinish(stream.streamId, (event) =>
      settle(
        event.success
          ? undefined
          : new Error('Write stream ended unsuccessfully')
      )
    );

    unsubscribeError = listenToWriteStreamError(stream.streamId, (event) =>
      settle(new Error(event.error))
    );

    let buffer: ArrayBuffer;
    try {
      buffer = typeof data === 'string' ? encodeContents(data, encoding) : data;
    } catch (error) {
      settle(error);
      return;
    }

    stream
      .write(buffer)
      .then(() => stream.end())
      .catch(settle);
  });
}

/**
 * Copies a file through a read stream and a write stream, reporting progress.
 *
 * Writes are serialised: native does not await the data callback, so issuing each
 * `write()` as the chunk arrives lets several be in flight at once and the destination can
 * be assembled out of order. Chunks are chained so at most one write is outstanding, and the
 * read stream is paused once more than `highWaterMark` chunks are waiting.
 *
 * @beta
 */
export async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  options: {
    bufferSize?: number;
    onProgress?: (progress: number) => void;
    /** Chunks allowed to queue before the read stream is paused. Defaults to 8. */
    highWaterMark?: number;
  } = {}
): Promise<void> {
  const {
    bufferSize = DEFAULT_STREAM_BUFFER_SIZE,
    onProgress,
    highWaterMark = DEFAULT_HIGH_WATER_MARK,
  } = options;

  const readStreamHandle = await createReadStream(sourcePath, { bufferSize });
  const writeStreamHandle = await createWriteStream(destPath, { bufferSize });

  return new Promise<void>((resolve, reject) => {
    const lowWaterMark = Math.max(1, Math.floor(highWaterMark / 2));

    let unsubscribeData: (() => void) | null = null;
    let unsubscribeProgress: (() => void) | null = null;
    let unsubscribeEnd: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;
    let unsubscribeWriteError: (() => void) | null = null;
    let unsubscribeWriteFinish: (() => void) | null = null;

    let queued = 0;
    let paused = false;
    let settled = false;
    // Set during teardown, so settle() has to consult it after closing rather than before.
    let writeFailure: unknown = null;

    // pause() and resume() are independent async native calls with no mutual ordering, so
    // overlapping them can land them in the opposite order - the resume no-ops and the late
    // pause parks the reader for good. Serialising through one chain makes that impossible.
    // Rejections are ignored: both report an unknown stream once the loop has finished.
    let controlChain: Promise<void> = Promise.resolve();
    const control = (op: () => Promise<void>): Promise<void> => {
      controlChain = controlChain.then(op).catch(() => {});
      return controlChain;
    };
    // Serialises writes: each chunk waits for the previous one to land.
    let writeChain: Promise<void> = Promise.resolve();

    const cleanup = () => {
      unsubscribeData?.();
      unsubscribeProgress?.();
      unsubscribeEnd?.();
      unsubscribeError?.();
    };

    // Async, but never rejects - it always ends in `resolve` or `reject` - so call sites
    // deliberately do not await it.
    const settle = async (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();

      // Close both handles on every exit path, including the happy one.
      let closeError: unknown;
      try {
        await writeStreamHandle.close();
      } catch (e) {
        closeError = e;
      }
      await closeQuietly(readStreamHandle);

      // Closing is what makes the writer emit its verdict, so unsubscribe only now.
      unsubscribeWriteError?.();
      unsubscribeWriteFinish?.();

      if (error) reject(error);
      else if (writeFailure) reject(writeFailure);
      else if (closeError) reject(closeError);
      else resolve();
    };

    unsubscribeData = listenToReadStreamData(
      readStreamHandle.streamId,
      (event) => {
        if (settled) return;

        queued += 1;
        if (!paused && queued >= highWaterMark) {
          paused = true;
          control(() => readStreamHandle.pause());
        }

        writeChain = writeChain
          .then(async () => {
            if (settled) return;
            await writeStreamHandle.write(event.data);
            queued -= 1;

            if (paused && queued <= lowWaterMark) {
              paused = false;
              await control(() => readStreamHandle.resume());
            }
          })
          .catch((error) => {
            settle(error);
          });
      }
    );

    if (onProgress) {
      unsubscribeProgress = listenToReadStreamProgress(
        readStreamHandle.streamId,
        (event) => onProgress(event.progress)
      );
    }

    unsubscribeEnd = listenToReadStreamEnd(
      readStreamHandle.streamId,
      (event) => {
        // The reader is done, but queued writes may not be. Settle behind them.
        writeChain = writeChain.then(() =>
          settle(
            event.success
              ? undefined
              : new Error('Read stream ended unsuccessfully')
          )
        );
      }
    );

    unsubscribeError = listenToReadStreamError(
      readStreamHandle.streamId,
      (event) => {
        settle(new Error(event.error));
      }
    );

    // The reader can end cleanly over a writer that died, so watch the write side too.
    unsubscribeWriteError = listenToWriteStreamError(
      writeStreamHandle.streamId,
      (event) => {
        writeFailure ??= new Error(event.error);
        settle(writeFailure);
      }
    );

    unsubscribeWriteFinish = listenToWriteStreamFinish(
      writeStreamHandle.streamId,
      (event) => {
        if (event.success) return;
        writeFailure ??= new Error('Write stream ended unsuccessfully');
        settle(writeFailure);
      }
    );

    readStreamHandle.start().catch((error) => {
      settle(error);
    });
  });
}

/**
 * Reads a file through a stream, handing each chunk to `chunkProcessor`.
 *
 * The processor is awaited before the next chunk is handed over, so chunks are always
 * processed in order even though native does not await the data callback.
 *
 * @beta
 */
export async function processFileInChunks(
  filePath: string,
  chunkProcessor: (
    chunk: ArrayBuffer,
    chunkIndex: number,
    position: number
  ) => Promise<void> | void,
  options: ReadStreamOptions & {
    /** Chunks allowed to queue before the read stream is paused. Defaults to 8. */
    highWaterMark?: number;
  } = {}
): Promise<void> {
  const { highWaterMark = DEFAULT_HIGH_WATER_MARK, ...readOptions } = options;
  const stream = await createReadStream(filePath, {
    bufferSize: DEFAULT_STREAM_BUFFER_SIZE,
    ...readOptions,
  });

  const lowWaterMark = Math.max(1, Math.floor(highWaterMark / 2));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let queued = 0;
    let paused = false;
    let processChain: Promise<void> = Promise.resolve();

    // See copyFileWithProgress: pause and resume must never be in flight together.
    let controlChain: Promise<void> = Promise.resolve();
    const control = (op: () => Promise<void>): Promise<void> => {
      controlChain = controlChain.then(op).catch(() => {});
      return controlChain;
    };

    let unsubscribeData: (() => void) | null = null;
    let unsubscribeEnd: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;

    const cleanup = () => {
      unsubscribeData?.();
      unsubscribeEnd?.();
      unsubscribeError?.();
    };

    const settle = async (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      await closeQuietly(stream);
      if (error) reject(error);
      else resolve();
    };

    unsubscribeData = listenToReadStreamData(stream.streamId, (event) => {
      if (settled) return;

      // Awaiting the processor orders chunks but does not slow the reader; only pausing does.
      queued += 1;
      if (!paused && queued >= highWaterMark) {
        paused = true;
        control(() => stream.pause());
      }

      processChain = processChain
        .then(async () => {
          if (settled) return;
          await chunkProcessor(event.data, event.chunk, event.position);
        })
        .then(async () => {
          queued -= 1;
          if (paused && queued <= lowWaterMark) {
            paused = false;
            await control(() => stream.resume());
          }
        })
        .catch((error) => {
          settle(error);
        });
    });

    unsubscribeEnd = listenToReadStreamEnd(stream.streamId, (event) => {
      processChain = processChain.then(() =>
        settle(
          event.success
            ? undefined
            : new Error('Read stream ended unsuccessfully')
        )
      );
    });

    unsubscribeError = listenToReadStreamError(stream.streamId, (event) => {
      settle(new Error(event.error));
    });

    stream.start().catch((error) => {
      settle(error);
    });
  });
}
