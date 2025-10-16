# File Stream API

React-native-fs2-nitro provides powerful file streaming capabilities for reading and writing large files efficiently. The stream API uses Nitro's callback system to handle events without blocking the JavaScript thread.

## Overview

File streams are ideal for handling large files where loading entire content into memory would be inefficient or cause memory issues. The streaming API provides:

- **Read Streams**: Read files in chunks with progress callbacks
- **Write Streams**: Write files in chunks with progress callbacks  
- **Memory Efficient**: Process large files without loading entire content into memory
- **Event-Driven**: Use Nitro callbacks for real-time progress updates
- **Cross-Platform**: Consistent API across iOS and Android

> **Note:** The stream API is now binary-only. All encoding/decoding (e.g., UTF-8, Base64) must be handled in JavaScript. Native code only receives and returns `ArrayBuffer`.

## Read Stream API

### `createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadStreamHandle>`

Creates a read stream for efficiently reading large files in chunks.

**Parameters:**
- `path`: File path to read from
- `options`: Optional configuration for the read stream

**Returns:** Promise that resolves to a `ReadStreamHandle`

#### ReadStreamOptions

```typescript
interface ReadStreamOptions {
  bufferSize?: number;      // Buffer size in bytes (default: 4096)
  start?: number;           // Start position in bytes (default: 0)
  end?: number;             // End position in bytes (default: file end)
}
```

#### ReadStreamHandle

```typescript
interface ReadStreamHandle {
  streamId: string;
  
  // Start reading the stream
  start(): Promise<void>;
  
  // Pause the stream
  pause(): Promise<void>;
  
  // Resume the stream
  resume(): Promise<void>;
  
  // Close the stream and cleanup resources
  close(): Promise<void>;
  
  // Check if stream is active
  isActive(): Promise<boolean>;
}
```

### Stream Event Listeners

```typescript
// Listen for data chunks
function listenToReadStreamData(
  streamId: string,
  onData: (event: ReadStreamDataEvent) => void
): () => void;

// Listen for stream completion
function listenToReadStreamEnd(
  streamId: string,
  onEnd: (event: ReadStreamEndEvent) => void
): () => void;

// Listen for stream errors
function listenToReadStreamError(
  streamId: string,
  onError: (event: ReadStreamErrorEvent) => void
): () => void;

// Listen for stream progress
function listenToReadStreamProgress(
  streamId: string,
  onProgress: (event: ReadStreamProgressEvent) => void
): () => void;
```

#### Event Types

```typescript
interface ReadStreamDataEvent {
  streamId: string;
  data: ArrayBuffer;     // Raw data chunk
  chunk: number;         // Chunk number (0-based)
  position: number;      // Current position in file
}

interface ReadStreamProgressEvent {
  streamId: string;
  bytesRead: number;     // Total bytes read so far
  totalBytes: number;    // Total file size
  progress: number;      // Progress as percentage (0-100)
}

interface ReadStreamEndEvent {
  streamId: string;
  bytesRead: number;     // Total bytes read
  success: boolean;
}

interface ReadStreamErrorEvent {
  streamId: string;
  error: string;         // Error message
  code?: string;         // Error code
}
```

### Read Stream Example

```typescript
import { Fs2, concatenateArrayBuffers, listenToReadStreamData, listenToReadStreamProgress, listenToReadStreamEnd, listenToReadStreamError } from 'react-native-fs2-nitro';

async function readLargeFile() {
  try {
    // Create read stream
    const stream = await Fs2.createReadStream('/path/to/large-file.dat', {
      bufferSize: 8192 // 8KB chunks
    });

    let totalData = new ArrayBuffer(0);

    // Listen for data chunks
    const unsubscribeData = listenToReadStreamData(
      stream.streamId,
      (event) => {
        console.log(`Received chunk ${event.chunk}, ${event.data.byteLength} bytes`);
        // Accumulate data (for small files) or process chunk immediately
        totalData = concatenateArrayBuffers(totalData, event.data);
      }
    );

    // Listen for progress updates
    const unsubscribeProgress = listenToReadStreamProgress(
      stream.streamId,
      (event) => {
        console.log(`Progress: ${(event.progress * 100).toFixed(1)}% (${event.bytesRead}/${event.totalBytes})`);
      }
    );

    // Listen for completion
    const unsubscribeEnd = listenToReadStreamEnd(
      stream.streamId,
      (event) => {
        console.log('Stream finished successfully');
        unsubscribeData();
        unsubscribeProgress();
        unsubscribeEnd();
      }
    );

    // Listen for errors
    const unsubscribeError = listenToReadStreamError(
      stream.streamId,
      (event) => {
        console.error('Stream error:', event.error);
        unsubscribeData();
        unsubscribeProgress();
        unsubscribeEnd();
        unsubscribeError();
      }
    );

    // Start reading
    await stream.start();

  } catch (error) {
    console.error('Failed to create read stream:', error);
  }
}
```

## Write Stream API

### `createWriteStream(path: string, options?: WriteStreamOptions): Promise<WriteStreamHandle>`

Creates a write stream for efficiently writing large files in chunks.

**Parameters:**
- `path`: File path to write to
- `options`: Optional configuration for the write stream

**Returns:** Promise that resolves to a `WriteStreamHandle`

#### WriteStreamOptions

```typescript
interface WriteStreamOptions {
  append?: boolean;         // Append to existing file (default: false)
  bufferSize?: number;      // Internal buffer size (default: 4096)
  createDirectories?: boolean; // Create parent directories if needed (default: true)
}
```

#### WriteStreamHandle

```typescript
interface WriteStreamHandle {
  streamId: string;

  // Write data chunk to stream
  write(data: ArrayBuffer): Promise<void>;

  // Flush any buffered data
  flush(): Promise<void>;

  // Close the stream and finish writing
  close(): Promise<void>;

  // Check if stream is active
  isActive(): Promise<boolean>;

  // Get current write position
  getPosition(): Promise<number>;

  // End the stream (alias for close)
  end(): Promise<void>;
}
```

### Stream Event Listeners

```typescript
// Listen for write progress
function listenToWriteStreamProgress(
  streamId: string,
  onProgress: (event: WriteStreamProgressEvent) => void
): () => void;

// Listen for write completion
function listenToWriteStreamFinish(
  streamId: string,
  onFinish: (event: WriteStreamFinishEvent) => void
): () => void;

// Listen for write errors
function listenToWriteStreamError(
  streamId: string,
  onError: (event: WriteStreamErrorEvent) => void
): () => void;
```

#### Event Types

```typescript
interface WriteStreamProgressEvent {
  streamId: string;
  bytesWritten: number;    // Total bytes written so far
  lastChunkSize: number;   // Size of last written chunk
}

interface WriteStreamFinishEvent {
  streamId: string;
  bytesWritten: number;    // Total bytes written
  success: boolean;
}

interface WriteStreamErrorEvent {
  streamId: string;
  error: string;           // Error message
  code?: string;           // Error code
}
```

### Write Stream Example

```typescript
import { Fs2, listenToWriteStreamProgress, listenToWriteStreamFinish, listenToWriteStreamError } from 'react-native-fs2-nitro';

async function writeLargeFile() {
  try {
    // Create write stream
    const stream = await Fs2.createWriteStream('/path/to/output-file.dat', {
      append: false,
      createDirectories: true
    });

    // Listen for progress
    const unsubscribeProgress = listenToWriteStreamProgress(
      stream.streamId,
      (event) => {
        console.log(`Written: ${event.bytesWritten} bytes`);
      }
    );

    // Listen for completion
    const unsubscribeFinish = listenToWriteStreamFinish(
      stream.streamId,
      (event) => {
        console.log('Write completed:', event.bytesWritten, 'bytes');
        unsubscribeProgress();
        unsubscribeFinish();
      }
    );

    // Listen for errors
    const unsubscribeError = listenToWriteStreamError(
      stream.streamId,
      (event) => {
        console.error('Write error:', event.error);
        unsubscribeProgress();
        unsubscribeFinish();
        unsubscribeError();
      }
    );

    // Write data in chunks
    const chunkSize = 8192;
    const totalData = generateLargeData(); // Your data source
    
    for (let i = 0; i < totalData.byteLength; i += chunkSize) {
      const chunk = totalData.slice(i, Math.min(i + chunkSize, totalData.byteLength));
      await stream.write(chunk);
    }

    // Finish writing
    await stream.close();

  } catch (error) {
    console.error('Failed to create write stream:', error);
  }
}
```

## Utility Functions

### Text and Binary Processing with Streams

```typescript
import { readStream, writeStream } from 'react-native-fs2-nitro';

// Read a file as a string (text mode)
async function readTextFile(filePath: string, encoding: 'utf8' = 'utf8') {
  const content = await readStream(filePath, encoding);
  // content is a string
}

// Read a file as binary (default)
async function readBinaryFile(filePath: string) {
  const buffer = await readStream(filePath); // default is 'arraybuffer'
  // buffer is an ArrayBuffer
}

// Write a string to a file (text mode)
async function writeTextFile(filePath: string, text: string, encoding: 'utf8' = 'utf8') {
  await writeStream(filePath, text, encoding);
}

// Write binary data to a file (default)
async function writeBinaryFile(filePath: string, buffer: ArrayBuffer) {
  await writeStream(filePath, buffer); // default is 'arraybuffer'
}
```

### File Copy with Progress

```typescript
import { copyFileWithProgress } from 'react-native-fs2-nitro';

async function copyFileWithProgressExample(
  sourcePath: string,
  destPath: string,
  onProgress?: (progress: number) => void
) {
  await copyFileWithProgress(sourcePath, destPath, { bufferSize: 16384, onProgress });
}
```

## Performance Tips

1. **Buffer Size**: Choose appropriate buffer sizes based on your use case:
   - Small files (< 1MB): 4KB - 8KB buffers
   - Medium files (1-100MB): 16KB - 64KB buffers  
   - Large files (> 100MB): 64KB - 256KB buffers

2. **Memory Management**: Always unsubscribe from event listeners to prevent memory leaks

3. **Error Handling**: Always handle both stream errors and promise rejections

4. **Threading**: Stream operations run on background threads, keeping the UI responsive

5. **Encoding**: All encoding/decoding is handled in JavaScript. Native code only deals with `ArrayBuffer`.

## Error Codes

Common error codes you may encounter:

- `ENOENT`: File not found
- `EACCES`: Permission denied
- `EISDIR`: Path is a directory
- `ENOSPC`: No space left on device
- `EMFILE`: Too many open files
- `STREAM_CLOSED`: Stream was closed unexpectedly
- `STREAM_ERROR`: General stream operation error

## Migration from blob-util

If migrating from react-native-blob-util's stream API:

```typescript
// blob-util style
ReactNativeBlobUtil.fs.readStream(path, encoding, bufferSize)
  .then(stream => {
    stream.open();
    stream.onData(chunk => { /* handle chunk */ });
    stream.onEnd(() => { /* handle end */ });
  });

// fs2-nitro style  
const stream = await Fs2.createReadStream(path, { bufferSize });
const unsubscribeData = Fs2.listenToReadStreamData(stream.streamId, event => { 
  /* handle event.data */ 
});

const unsubscribeEnd = Fs2.listenToReadStreamEnd(stream.streamId, () => { 
  /* handle end */ 
});

await stream.start();
```

The new API provides better type safety, automatic memory management, and consistent cross-platform behavior.
