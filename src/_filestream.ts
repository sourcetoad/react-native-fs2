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
  onData: (event: ReadStreamDataEvent) => void | Promise<void>
): () => void {
  // `async` is load-bearing twice over. Native awaits what this returns before reading the
  // next chunk, which is the only back-pressure the read path has; and the C++ converter
  // calls `.then` on the returned value, so it has to be a thenable even when `onData` is
  // synchronous.
  const onDataNitro = async (event: ReadStreamDataEventNitro) => {
    const eventPlain = convertFs2StreamEventResultsToPlain(event);

    await onData(eventPlain as ReadStreamDataEvent);
    // The value is ignored - see the note on `onData` in Fs2Stream.nitro.ts for why this
    // resolves to something rather than to `undefined`.
    return true;
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
 * Like {@link concatenateChunks}, but empties `chunks` as it copies.
 *
 * Holding the chunk list alongside the assembled copy doubles the peak for the whole
 * duration of the join. Dropping each reference as its bytes are copied means only the
 * chunks not yet copied are live, so the peak is the result plus one chunk.
 */
function consumeChunks(chunks: ArrayBuffer[]): ArrayBuffer {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;

  const combined = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
    // @ts-expect-error - deliberately dropping the reference, not shortening the array.
    chunks[i] = undefined;
  }
  chunks.length = 0;
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
 * How many chunks may sit un-written before the read stream is held.
 */
const DEFAULT_HIGH_WATER_MARK = 8;

/**
 * Bounds how far the reader may run ahead of the consumer.
 *
 * The data callback returns {@link admit}'s promise, and the native read loop awaits it
 * before reading the next chunk, so the pipeline can never hold more than `highWaterMark`
 * chunks. This replaces the older `pause()`/`resume()` pair: those are two independent
 * async calls with no mutual ordering, so a resume landing before its pause left the reader
 * parked with nothing to wake it.
 */
function createBackPressureGate(highWaterMark: number) {
  const lowWaterMark = Math.max(1, Math.floor(highWaterMark / 2));
  let queued = 0;
  let waiters: Array<() => void> = [];

  const drain = () => {
    if (waiters.length === 0 || queued > lowWaterMark) return;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  return {
    /** Records a chunk handed to the consumer, and returns the reader's leash. */
    admit(): Promise<void> | undefined {
      queued += 1;
      if (queued < highWaterMark) return undefined;
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    /** Records a chunk that has actually landed. */
    release(): void {
      queued -= 1;
      drain();
    },
    /** Releases every parked reader - the stream is over, one way or the other. */
    close(): void {
      queued = 0;
      drain();
    },
  };
}

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

      const assembled = consumeChunks(chunks);
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
 * Writes are serialised: issuing each `write()` as the chunk arrives would let several be in
 * flight at once and the destination could be assembled out of order. Chunks are chained so
 * at most one write is outstanding, and the data callback returns a promise that holds the
 * native reader once more than `highWaterMark` chunks are waiting.
 *
 * @beta
 */
export async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  options: {
    bufferSize?: number;
    onProgress?: (progress: number) => void;
    /** Chunks allowed to queue before the read stream is held. Defaults to 8. */
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
    const gate = createBackPressureGate(highWaterMark);

    let unsubscribeData: (() => void) | null = null;
    let unsubscribeProgress: (() => void) | null = null;
    let unsubscribeEnd: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;
    let unsubscribeWriteError: (() => void) | null = null;
    let unsubscribeWriteFinish: (() => void) | null = null;

    let settled = false;
    // Set during teardown, so settle() has to consult it after closing rather than before.
    let writeFailure: unknown = null;

    // Serialises writes: each chunk waits for the previous one to land.
    let writeChain: Promise<void> = Promise.resolve();

    const cleanup = () => {
      gate.close();
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

        const admitted = gate.admit();

        writeChain = writeChain
          .then(async () => {
            if (settled) return;
            await writeStreamHandle.write(event.data);
          })
          .then(
            () => gate.release(),
            (error) => {
              gate.release();
              settle(error);
            }
          );

        return admitted;
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
 * processed in order, and the reader is held once more than `highWaterMark` chunks are
 * waiting on it.
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
    /** Chunks allowed to queue before the read stream is held. Defaults to 8. */
    highWaterMark?: number;
  } = {}
): Promise<void> {
  const { highWaterMark = DEFAULT_HIGH_WATER_MARK, ...readOptions } = options;
  const stream = await createReadStream(filePath, {
    bufferSize: DEFAULT_STREAM_BUFFER_SIZE,
    ...readOptions,
  });

  return new Promise<void>((resolve, reject) => {
    const gate = createBackPressureGate(highWaterMark);

    let settled = false;
    let processChain: Promise<void> = Promise.resolve();

    let unsubscribeData: (() => void) | null = null;
    let unsubscribeEnd: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;

    const cleanup = () => {
      gate.close();
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

      // Chaining orders the chunks; returning `admitted` is what slows the reader down.
      const admitted = gate.admit();

      processChain = processChain
        .then(async () => {
          if (settled) return;
          await chunkProcessor(event.data, event.chunk, event.position);
        })
        .then(
          () => gate.release(),
          (error) => {
            gate.release();
            settle(error);
          }
        );

      return admitted;
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
