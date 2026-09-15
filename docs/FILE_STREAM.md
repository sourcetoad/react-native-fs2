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
  bufferSize?: number;  // Chunk size in bytes (default: 65536)
  start?: number;       // Start position in bytes (default: 0)
  end?: number;         // End position in bytes (default: end of file)
}
```

`bufferSize` defaults to **64 KB** on both sides — the high-level helpers pass it explicitly
(`src/_filestream.ts`), and native falls back to the same figure
(`ios/Fs2Stream.swift`, `android/.../Fs2Stream.kt`). Each chunk costs one JSI round trip, so a
small size dominates the cost of a large read.

It must be an integer between 1 and 16 MB; anything else is rejected before it reaches native,
where `0` used to spin the Android read loop forever and a non-finite value aborted the iOS
process.

#### ExtendedReadStreamHandle

`createReadStream` returns `ExtendedReadStreamHandle`, which is the bare Nitro
`ReadStreamHandle` (just a `streamId`) plus the control methods:

```typescript
interface ExtendedReadStreamHandle {
  streamId: string;

  start(): Promise<void>;      // Begin reading
  pause(): Promise<void>;      // Pause the read loop
  resume(): Promise<void>;     // Resume after pause()  (see back-pressure, below)
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
  onData: (event: ReadStreamDataEvent) => void | Promise<void>
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

`onData` may return a promise. The native read loop awaits it before reading the next chunk,
so an `async` data listener is how you apply back-pressure — see
[back-pressure](#back-pressure).

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
  totalBytes: number;  // Bytes in the requested range (the whole file unless start/end are set)
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

`progress` is measured against the **requested range**, so a stream with `start`/`end` set
still finishes at 1.0. It is a **fraction between 0 and 1**, not a percentage
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
  bufferSize?: number;         // Bytes allowed to queue at once (default: 65536)
  createDirectories?: boolean; // Create missing parent directories (default: false)
}
```

#### ExtendedWriteStreamHandle

```typescript
interface ExtendedWriteStreamHandle {
  streamId: string;

  write(data: ArrayBuffer): Promise<void>;  // Queue a chunk
  flush(): Promise<void>;                   // Sync everything written so far to disk
  close(): Promise<void>;                   // Drain the queue and finish
  isActive(): Promise<boolean>;
  getPosition(): Promise<number>;           // Bytes actually written
  end(): Promise<void>;                     // Same operation as close()
}
```

#### `write()` resolves when there is room, not when the bytes are on disk

Both platforms hand the chunk to a background writer. `write()` resolves once the chunk fits
within `bufferSize` bytes of queued data, which is the same contract as Node's
`writable.write()` plus `'drain'` — awaiting it is what keeps a producer from outrunning the
disk. Await every `write()`: a caller that fires them without awaiting has no bound on how much
it hands over, exactly as in Node.

Two consequences are easy to trip over:

- **`getPosition()` lags.** It reports bytes actually written, so reading it straight after
  `write()` resolves can return the position from before that chunk. Wait for a write-progress
  event when you need an exact figure.
- **Terminate the stream before assuming the file is complete.** `end()` waits for the queue
  to drain; so does `close()`. Until one of them resolves, the file on disk may be short.

```typescript
const stream = await createWriteStream(path, { bufferSize: 256 * 1024 });

const landed = new Promise<number>((resolve) =>
  listenToWriteStreamProgress(stream.streamId, (e) => resolve(e.bytesWritten))
);
await stream.write(data);   // there is room for it
await landed;               // written
await stream.getPosition(); // now accurate
```

#### `flush()` waits for the bytes to reach the disk

`flush()` is queued behind the writes issued before it, so awaiting it means every chunk
written up to that point has been handed to the file and synced (`fsync` on iOS and on a real
file on Android; a `content://` destination gets a userspace flush, which is all its stream
offers). It rejects on a stream that has already been ended or closed.

It is not needed for durability at the end of a stream — `end()` and `close()` both drain and
sync. Reach for it when you want a checkpoint part-way through a long write.

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

Writes are serialised — at most one is in flight — and the reader is held once more than
`highWaterMark` chunks are queued, released again at half that. Both streams are closed on
every exit path. See [back-pressure](#back-pressure) for how the hold works.

### `processFileInChunks(filePath, chunkProcessor, options?): Promise<void>`

Reads a file through a stream, handing each chunk to your processor. The processor is awaited
before the next chunk is handed over, so chunks arrive **in order**, and the reader is held
once more than `highWaterMark` chunks (default 8) are outstanding.

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

## Back-pressure

The read loop runs on a background thread and would otherwise read at disk speed regardless of
how fast the consumer is. Everything it read ahead would sit in the JSI dispatcher's unbounded
queue as an owning copy, so peak memory tracked the **file** size rather than the buffer size —
a 1 GB file at the 64 KB default is 16,384 chunks queued ahead of JS.

The bound lives in native. The data callback is declared as returning `Promise<void>`, and both
read loops await it before reading the next chunk:

```typescript
listenToReadStreamData(stream.streamId, async (event) => {
  await uploadPart(event.data);   // the reader waits here
});
```

A synchronous listener still works — it is wrapped so native always has something to await, and
the reader advances after one round trip. Two things to know:

- **A listener that never settles parks the reader.** The descriptor stays open until
  `close()`, which interrupts a loop waiting on the consumer.
- **A listener that throws fails the stream.** The rejection propagates to native and surfaces
  as a read-stream error event, rather than being swallowed.

On the write side, `write()` resolves when the chunk fits within `bufferSize` bytes of queued
data, so awaiting it is the producer's leash. `copyFileWithProgress` and `processFileInChunks`
combine both: they return a promise from the data callback that resolves once fewer than
`highWaterMark` chunks are outstanding, which keeps the reader and the writer pipelined without
either running away.

`pause()` and `resume()` remain on the handle for manual control, but the helpers no longer use
them: they are independent async calls with no mutual ordering, so a resume landing before its
pause left the reader parked with nothing to wake it.

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
