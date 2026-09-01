# File Stream API

`react-native-fs2` provides file streaming for reading and writing large files without holding
the whole file in memory. The stream API uses Nitro's callback system, so chunks cross into JS
without blocking the JavaScript thread.

> **Beta.** Every export in this module is marked `@beta` and may change without a major
> version bump (`src/_filestream.ts:1-5`).

## Overview

Streams are for files large enough that reading them whole would be wasteful or fatal:

- **Read streams** — read a file in chunks, with progress
- **Write streams** — write a file in chunks, with progress
- **Memory efficient** — process a file of any size in bounded memory
- **Event driven** — Nitro callbacks, no bridge, no polling
- **Cross-platform** — the same surface on iOS and Android

> **Binary only.** Native sends and receives `ArrayBuffer` and nothing else. All
> encoding and decoding (UTF-8, Base64, ASCII) happens in JavaScript.

### Importing

Every stream export is a **top-level named export** of the package. There is no `Fs2` object to
reach them through:

```typescript
import {
  createReadStream,
  createWriteStream,
  listenToReadStreamData,
  readStream,
  copyFileWithProgress,
} from 'react-native-fs2';
```

The default export (`import RNFS from 'react-native-fs2'`) carries the classic file API —
`readFile`, `writeFile`, `stat` and the rest — and does **not** carry the stream functions.

## Read Stream API

### `createReadStream(path, options?): Promise<ExtendedReadStreamHandle>`

Creates a read stream for reading a large file in chunks.

**Parameters:**
- `path`: file path to read from
- `options`: optional `ReadStreamOptions`

**Returns:** a promise for an `ExtendedReadStreamHandle`. Nothing is read until you call
`start()`.

#### ReadStreamOptions

```typescript
interface ReadStreamOptions {
  bufferSize?: number;  // Chunk size in bytes (native default: 8192)
  start?: number;       // Start position in bytes (default: 0)
  end?: number;         // End position in bytes (default: end of file)
}
```

`bufferSize` left unset falls through to the native default of **8 KB**
(`ios/BufferPool.swift:6`, `android/.../utils/BufferPool.kt:84`). The high-level helpers below
(`readStream`, `writeStream`, `copyFileWithProgress`, `processFileInChunks`) instead default to
**64 KB** (`src/_filestream.ts:368`), because each chunk costs one JSI round trip and a small
size dominates the cost of a large read.

#### ExtendedReadStreamHandle

`createReadStream` returns `ExtendedReadStreamHandle`, which is the bare Nitro
`ReadStreamHandle` (just a `streamId`) plus the control methods:

```typescript
interface ExtendedReadStreamHandle {
  streamId: string;

  start(): Promise<void>;      // Begin reading
  pause(): Promise<void>;      // Pause the read loop
  resume(): Promise<void>;     // Resume after pause()
  close(): Promise<void>;      // Close and release native resources
  isActive(): Promise<boolean>;
}
```

The bare `ReadStreamHandle` / `WriteStreamHandle` interfaces are not re-exported; the
`Extended*` ones are what you receive and what you can name.

### Stream event listeners

```typescript
function listenToReadStreamData(
  streamId: string,
  onData: (event: ReadStreamDataEvent) => void
): () => void;

function listenToReadStreamProgress(
  streamId: string,
  onProgress: (event: ReadStreamProgressEvent) => void
): () => void;

function listenToReadStreamEnd(
  streamId: string,
  onEnd: (event: ReadStreamEndEvent) => void
): () => void;

function listenToReadStreamError(
  streamId: string,
  onError: (event: ReadStreamErrorEvent) => void
): () => void;
```

Each returns an unsubscribe function.

> **One subscriber per (stream, event).** The native side keeps a single callback per stream
> per event, so registering a second callback for the same pair **replaces** the first, and
> either returned unsubscribe removes whichever is currently installed
> (`src/_filestream.ts:146-152`). In particular, never subscribe to a stream that
> `copyFileWithProgress` or `processFileInChunks` is already driving — you will silently
> displace its listener and break it.

#### Event types

```typescript
interface ReadStreamDataEvent {
  streamId: string;
  data: ArrayBuffer;  // Raw chunk
  chunk: number;      // Chunk index (0-based)
  position: number;   // Byte offset of this chunk in the file
}

interface ReadStreamProgressEvent {
  streamId: string;
  bytesRead: number;   // Total bytes read so far
  totalBytes: number;  // Total file size
  progress: number;    // Fraction from 0 to 1 - multiply by 100 for a percentage
}

interface ReadStreamEndEvent {
  streamId: string;
  bytesRead: number;   // Total bytes read
  success: boolean;
}

interface ReadStreamErrorEvent {
  streamId: string;
  error: string;  // Message, `CODE: description`
  code?: string;
}
```

`progress` is a **fraction between 0 and 1**, not a percentage
(`ios/Fs2Stream.swift:353`, `android/.../Fs2Stream.kt:291`).

### Read stream example

```typescript
import {
  createReadStream,
  listenToReadStreamData,
  listenToReadStreamProgress,
  listenToReadStreamEnd,
  listenToReadStreamError,
  concatenateChunks,
} from 'react-native-fs2';

async function readLargeFile() {
  const stream = await createReadStream('/path/to/large-file.dat', {
    bufferSize: 8192, // 8KB chunks
  });

  // Collect into an array and join once. Calling concatenateArrayBuffers per
  // chunk instead would recopy everything accumulated so far, every chunk.
  const chunks: ArrayBuffer[] = [];

  const unsubscribeData = listenToReadStreamData(stream.streamId, (event) => {
    console.log(`Chunk ${event.chunk}, ${event.data.byteLength} bytes`);
    chunks.push(event.data);
  });

  const unsubscribeProgress = listenToReadStreamProgress(stream.streamId, (event) => {
    // progress is 0..1
    console.log(
      `Progress: ${(event.progress * 100).toFixed(1)}% (${event.bytesRead}/${event.totalBytes})`
    );
  });

  const cleanup = () => {
    unsubscribeData();
    unsubscribeProgress();
    unsubscribeEnd();
    unsubscribeError();
  };

  const unsubscribeEnd = listenToReadStreamEnd(stream.streamId, () => {
    console.log('Stream finished:', concatenateChunks(chunks).byteLength, 'bytes');
    cleanup();
  });

  const unsubscribeError = listenToReadStreamError(stream.streamId, (event) => {
    console.error('Stream error:', event.error);
    cleanup();
  });

  await stream.start();
}
```

## Write Stream API

### `createWriteStream(path, options?): Promise<ExtendedWriteStreamHandle>`

Creates a write stream for writing a large file in chunks.

**Parameters:**
- `path`: file path to write to
- `options`: optional `WriteStreamOptions`

**Returns:** a promise for an `ExtendedWriteStreamHandle`.

#### WriteStreamOptions

```typescript
interface WriteStreamOptions {
  append?: boolean;            // Append to an existing file (default: false)
  bufferSize?: number;         // Internal buffer size in bytes (native default: 8192)
  createDirectories?: boolean; // Create missing parent directories (default: true)
}
```

#### ExtendedWriteStreamHandle

```typescript
interface ExtendedWriteStreamHandle {
  streamId: string;

  write(data: ArrayBuffer): Promise<void>;  // Queue a chunk
  flush(): Promise<void>;                   // Flush buffered data
  close(): Promise<void>;                   // Drain the queue and finish
  isActive(): Promise<boolean>;
  getPosition(): Promise<number>;           // Bytes actually written
  end(): Promise<void>;                     // Same operation as close()
}
```

#### `write()` resolves when a chunk is accepted, not when it is written

Both platforms hand the chunk to a background writer and resolve immediately. Two consequences
are easy to trip over:

- **`getPosition()` lags.** It reports bytes actually written, so reading it straight after
  `write()` resolves can return the position from before that chunk — or `0`, if nothing has
  drained yet. Wait for a write-progress event when you need an exact figure.
- **Terminate the stream before assuming the file is complete.** `end()` waits for the queue
  to drain; so does `close()`. Until one of them resolves, the file on disk may be short.

```typescript
const stream = await createWriteStream(path);

const landed = new Promise<number>((resolve) =>
  listenToWriteStreamProgress(stream.streamId, (e) => resolve(e.bytesWritten))
);
await stream.write(data);   // accepted
await landed;               // written
await stream.getPosition(); // now accurate
```

#### `end()` and `close()` are the same operation

Call one, not both. Whichever runs first drains the queue and drops the stream, so the second
reports `ENOENT: No such write stream`. This is why the high-level helpers wrap their cleanup
in a swallow-and-continue rather than propagating that error.

### Stream event listeners

```typescript
function listenToWriteStreamProgress(
  streamId: string,
  onProgress: (event: WriteStreamProgressEvent) => void
): () => void;

function listenToWriteStreamFinish(
  streamId: string,
  onFinish: (event: WriteStreamFinishEvent) => void
): () => void;

function listenToWriteStreamError(
  streamId: string,
  onError: (event: WriteStreamErrorEvent) => void
): () => void;
```

The single-subscriber rule above applies to these too.

#### Event types

```typescript
interface WriteStreamProgressEvent {
  streamId: string;
  bytesWritten: number;   // Total bytes written so far
  lastChunkSize: number;  // Size of the chunk that just landed
}

interface WriteStreamFinishEvent {
  streamId: string;
  bytesWritten: number;   // Total bytes written
  success: boolean;
}

interface WriteStreamErrorEvent {
  streamId: string;
  error: string;  // Message, `CODE: description`
  code?: string;
}
```

### Write stream example

```typescript
import {
  createWriteStream,
  listenToWriteStreamProgress,
  listenToWriteStreamFinish,
  listenToWriteStreamError,
} from 'react-native-fs2';

async function writeLargeFile(totalData: ArrayBuffer) {
  const stream = await createWriteStream('/path/to/output-file.dat', {
    append: false,
    createDirectories: true,
  });

  const unsubscribeProgress = listenToWriteStreamProgress(stream.streamId, (event) => {
    console.log(`Written: ${event.bytesWritten} bytes`);
  });

  const unsubscribeFinish = listenToWriteStreamFinish(stream.streamId, (event) => {
    console.log('Write completed:', event.bytesWritten, 'bytes');
  });

  const unsubscribeError = listenToWriteStreamError(stream.streamId, (event) => {
    console.error('Write error:', event.error);
  });

  try {
    const chunkSize = 8192;
    for (let i = 0; i < totalData.byteLength; i += chunkSize) {
      await stream.write(totalData.slice(i, Math.min(i + chunkSize, totalData.byteLength)));
    }

    // close() drains the queue. Do not also call end() - it is the same operation.
    await stream.close();
  } finally {
    unsubscribeProgress();
    unsubscribeFinish();
    unsubscribeError();
  }
}
```

## High-level helpers

These wrap the stream plumbing above, including listener setup and teardown. Because they
drive their own listeners, **do not subscribe to a stream one of them is running.**

### `readStream(filePath, encoding?, options?): Promise<string | ArrayBuffer>`

Reads a whole file through a stream. Chunks are joined once and decoded once over the
assembled buffer, so a multi-byte character straddling a chunk boundary survives.

`encoding` defaults to **`'arraybuffer'`**, not `'utf8'`. `options.bufferSize` defaults to
64 KB.

```typescript
import { readStream } from 'react-native-fs2';

const text = await readStream(filePath, 'utf8');           // string
const bytes = await readStream(filePath);                  // ArrayBuffer
const tuned = await readStream(filePath, 'utf8', { bufferSize: 128 * 1024 });
```

### `writeStream(filePath, data, encoding?): Promise<void>`

Writes a whole file through a stream. `encoding` also defaults to `'arraybuffer'`.

```typescript
import { writeStream } from 'react-native-fs2';

await writeStream(filePath, 'hello', 'utf8');
await writeStream(filePath, someArrayBuffer);
```

### `copyFileWithProgress(sourcePath, destPath, options?): Promise<void>`

Copies a file through a read stream into a write stream, reporting progress.

```typescript
import { copyFileWithProgress } from 'react-native-fs2';

await copyFileWithProgress(sourcePath, destPath, {
  bufferSize: 64 * 1024,                  // default 64 KB
  highWaterMark: 8,                       // default 8
  onProgress: (progress) => {             // 0..1, from the read stream
    console.log(`${(progress * 100).toFixed(1)}%`);
  },
});
```

Writes are serialised — at most one is in flight — and the read stream is paused once more
than `highWaterMark` chunks are queued, resuming at half that. Without the pause the reader
would run ahead of the writer without bound, because native does not await the data callback.
Both streams are closed on every exit path.

### `processFileInChunks(filePath, chunkProcessor, options?): Promise<void>`

Reads a file through a stream, handing each chunk to your processor. The processor is awaited
before the next chunk is handed over, so chunks arrive **in order** even though native does
not await the data callback.

```typescript
import { processFileInChunks } from 'react-native-fs2';

await processFileInChunks(
  filePath,
  async (chunk, chunkIndex, position) => {
    await uploadPart(chunk, chunkIndex, position);
  },
  { bufferSize: 64 * 1024 }  // ReadStreamOptions; start/end accepted too
);
```

## Buffer utilities

```typescript
function arrayBufferToString(buffer: ArrayBuffer, encoding?: Encoding): string;
function stringToArrayBuffer(str: string, encoding?: Encoding): ArrayBuffer;
function concatenateChunks(chunks: ArrayBuffer[]): ArrayBuffer;
function concatenateArrayBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer;
```

`arrayBufferToString` and `stringToArrayBuffer` default to `'utf8'`. Passing `'arraybuffer'`
to `arrayBufferToString` throws — there is no string to produce.

**Prefer `concatenateChunks`.** It joins in one allocation and one pass.
`concatenateArrayBuffers` takes exactly two buffers, so calling it in a loop reallocates and
recopies everything accumulated so far on every chunk — quadratic in the number of chunks.

## Performance tips

1. **Buffer size.** Each chunk costs one JSI round trip, so undersized buffers dominate the
   cost of a large read. Rough guide:
   - Small files (< 1 MB): 8 KB – 16 KB
   - Medium files (1–100 MB): 64 KB
   - Large files (> 100 MB): 64 KB – 256 KB
2. **Always unsubscribe.** Every `listenTo*` returns an unsubscribe function; call it on both
   the success and error paths.
3. **One subscriber per stream event.** A second registration silently evicts the first.
4. **Handle both failure channels.** A stream can fail through the error *event* or through a
   rejected promise from `start()`/`write()`/`close()`. Cover both.
5. **Threading.** Reads and writes run on background threads; the JS thread is not blocked.
6. **Encoding is a JS concern.** Native only ever sees `ArrayBuffer`.

## Error codes

Stream errors arrive as `CODE: description`, and the contract is
`err.message.startsWith('CODE')` — Android messages carry a trailing newline that iOS does
not, so exact `===` comparison will not work.

The stream layer emits three codes:

- `ENOENT` — file does not exist, or no stream with that id
  (`ENOENT: No such read stream`, `ENOENT: No such write stream`)
- `EACCES` — permission denied
- `EPIPE` — the stream is closed or not active

`ENOENT: No such write stream` after a successful `end()` or `close()` is the normal path, not
a failure: native drops its registry entry when the stream finishes. See the `end()`/`close()`
note above.

Other codes in this library (`EISDIR`, `ENOTSUP`, and the rest) come from the classic file API
on the default export, not from streams.
