# File Stream API

React-native-fs2-nitro provides powerful file streaming capabilities for reading and writing large files efficiently. The stream API uses Nitro's callback system to handle events without blocking the JavaScript thread.

## Overview

File streams are ideal for handling large files where loading entire content into memory would be inefficient or cause memory issues. The streaming API provides:

- **Read Streams**: Read files in chunks with progress callbacks
- **Write Streams**: Write files in chunks with progress callbacks  
- **Memory Efficient**: Process large files without loading entire content into memory
- **Event-Driven**: Use Nitro callbacks for real-time progress updates
- **Cross-Platform**: Consistent API across iOS and Android

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
  encoding?: StreamEncoding; // 'utf8' | 'ascii' | 'base64' | 'arraybuffer' (default: 'arraybuffer')
  start?: bigint;           // Start position in bytes (default: 0)
  end?: bigint;            // End position in bytes (default: file end)
}

type StreamEncoding = 'utf8' | 'ascii' | 'base64' | 'arraybuffer';
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
  chunk: bigint;         // Chunk number (0-based)
  position: bigint;      // Current position in file
  encoding: StreamEncoding;
}

interface ReadStreamProgressEvent {
  streamId: string;
  bytesRead: bigint;     // Total bytes read so far
  totalBytes: bigint;    // Total file size
  progress: number;      // Progress as percentage (0-100)
}

interface ReadStreamEndEvent {
  streamId: string;
  bytesRead: bigint;     // Total bytes read
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
import { Fs2 } from 'react-native-fs2-nitro';

async function readLargeFile() {
  try {
    // Create read stream
    const stream = await Fs2.createReadStream('/path/to/large-file.dat', {
      bufferSize: 8192,     // 8KB chunks
      encoding: 'arraybuffer'
    });

    let totalData = new ArrayBuffer(0);

    // Listen for data chunks
    const unsubscribeData = Fs2.listenToReadStreamData(
      stream.streamId,
      (event) => {
        console.log(`Received chunk ${event.chunk}, ${event.data.byteLength} bytes`);
        
        // Accumulate data (for small files) or process chunk immediately
        totalData = concatenateArrayBuffers(totalData, event.data);
      }
    );

    // Listen for progress updates
    const unsubscribeProgress = Fs2.listenToReadStreamProgress(
      stream.streamId,
      (event) => {
        console.log(`Progress: ${event.progress.toFixed(1)}% (${event.bytesRead}/${event.totalBytes})`);
      }
    );

    // Listen for completion
    const unsubscribeEnd = Fs2.listenToReadStreamEnd(
      stream.streamId,
      (event) => {
        console.log('Stream finished successfully');
        unsubscribeData();
        unsubscribeProgress();
        unsubscribeEnd();
      }
    );

    // Listen for errors
    const unsubscribeError = Fs2.listenToReadStreamError(
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
  encoding?: StreamEncoding; // 'utf8' | 'ascii' | 'base64' | 'arraybuffer' (default: 'arraybuffer')
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
  
  // Write string data (when encoding is utf8 or base64)
  writeString(data: string): Promise<void>;
  
  // Flush any buffered data
  flush(): Promise<void>;
  
  // Close the stream and finish writing
  close(): Promise<void>;
  
  // Check if stream is active
  isActive(): Promise<boolean>;
  
  // Get current write position
  getPosition(): Promise<bigint>;
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
  bytesWritten: bigint;    // Total bytes written so far
  lastChunkSize: bigint;   // Size of last written chunk
}

interface WriteStreamFinishEvent {
  streamId: string;
  bytesWritten: bigint;    // Total bytes written
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
import { Fs2 } from 'react-native-fs2-nitro';

async function writeLargeFile() {
  try {
    // Create write stream
    const stream = await Fs2.createWriteStream('/path/to/output-file.dat', {
      append: false,
      encoding: 'binary',
      createDirectories: true
    });

    // Listen for progress
    const unsubscribeProgress = Fs2.listenToWriteStreamProgress(
      stream.streamId,
      (event) => {
        console.log(`Written: ${event.bytesWritten} bytes`);
      }
    );

    // Listen for completion
    const unsubscribeFinish = Fs2.listenToWriteStreamFinish(
      stream.streamId,
      (event) => {
        console.log('Write completed:', event.bytesWritten, 'bytes');
        unsubscribeProgress();
        unsubscribeFinish();
      }
    );

    // Listen for errors
    const unsubscribeError = Fs2.listenToWriteStreamError(
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

### Text Processing with Streams

```typescript
// Read text file in chunks with specific encoding
async function readTextStream(filePath: string, encoding: 'utf8' = 'utf8') {
  const stream = await Fs2.createReadStream(filePath, { encoding });
  let content = '';

  return new Promise<string>((resolve, reject) => {
    const unsubscribeData = Fs2.listenToReadStreamData(stream.streamId, (event) => {
      // Convert ArrayBuffer to string based on encoding
      const chunk = arrayBufferToString(event.data, encoding);
      content += chunk;
    });

    const unsubscribeEnd = Fs2.listenToReadStreamEnd(stream.streamId, () => {
      unsubscribeData();
      unsubscribeEnd();
      resolve(content);
    });

    const unsubscribeError = Fs2.listenToReadStreamError(stream.streamId, (event) => {
      unsubscribeData();
      unsubscribeEnd();
      unsubscribeError();
      reject(new Error(event.error));
    });

    stream.start();
  });
}

// Write text with streaming
async function writeTextStream(filePath: string, text: string, encoding: 'utf8' = 'utf8') {
  const stream = await Fs2.createWriteStream(filePath, { encoding });
  
  const data = stringToArrayBuffer(text, encoding);
  await stream.write(data);
  await stream.close();
}
```

### File Copy with Progress

```typescript
async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  onProgress?: (progress: number) => void
) {
  const readStream = await Fs2.createReadStream(sourcePath, { bufferSize: 16384 });
  const writeStream = await Fs2.createWriteStream(destPath, { bufferSize: 16384 });

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
    unsubscribeData = Fs2.listenToReadStreamData(readStream.streamId, async (event) => {
      try {
        await writeStream.write(event.data);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    // Track progress
    if (onProgress) {
      unsubscribeProgress = Fs2.listenToReadStreamProgress(readStream.streamId, (event) => {
        onProgress(event.progress);
      });
    }

    // Handle completion
    unsubscribeEnd = Fs2.listenToReadStreamEnd(readStream.streamId, async () => {
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
    unsubscribeError = Fs2.listenToReadStreamError(readStream.streamId, (event) => {
      cleanup();
      reject(new Error(event.error));
    });

    // Start the copy
    readStream.start();
  });
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

5. **Encoding**: Use 'arraybuffer' encoding for maximum performance when dealing with raw data

## Platform Differences

### iOS
- Uses `NSInputStream` and `NSOutputStream` for efficient native streaming
- Supports all encoding types natively
- File system permissions handled automatically

### Android  
- Uses `FileInputStream` and `FileOutputStream` with buffer management
- UTF-8 and Base64 encoding handled efficiently
- Respects Android scoped storage requirements

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
const stream = await Fs2.createReadStream(path, { encoding, bufferSize });
const unsubscribeData = Fs2.listenToReadStreamData(stream.streamId, event => { 
  /* handle event.data */ 
});
const unsubscribeEnd = Fs2.listenToReadStreamEnd(stream.streamId, () => { 
  /* handle end */ 
});
await stream.start();
```

The new API provides better type safety, automatic memory management, and consistent cross-platform behavior.
