# 🚀 Nitro Modules Migration + Streaming API (Beta)

## Overview

This is a **major release** that completely reimagines `react-native-fs2` by migrating from the legacy React Native architecture to **[Nitro Modules](https://github.com/mrousavy/nitro)**, bringing significant performance improvements and introducing a powerful new **File Streaming API**.

## 🎯 Key Changes

### ✨ Migration to Nitro Modules

The entire native bridge has been rewritten using Nitro Modules, providing:

- **🚄 Superior Performance**: Direct JSI bindings eliminate the traditional React Native bridge overhead
- **🔒 Type Safety**: End-to-end type safety from TypeScript to native code (Swift/Kotlin)
- **⚡ Synchronous Operations**: Access to native constants without async overhead
- **🎨 Modern Architecture**: Leverages the latest React Native architecture patterns
- **📦 Better Code Generation**: Automatic code generation via Nitrogen for consistency across platforms

### 🌊 Streaming API (Beta)

Introducing a new **File Streaming API** for efficient handling of large files:

#### Read Streams
- Read files in chunks without loading entire content into memory
- Real-time progress callbacks
- Pause/resume capability
- Memory-efficient for large files

#### Write Streams  
- Write files in chunks with progress tracking
- Append mode support
- Automatic directory creation
- Efficient buffer management

#### Key Features
- **Binary-only native layer**: All encoding/decoding handled in JavaScript
- **Event-driven**: Uses Nitro's callback system for real-time updates
- **Cross-platform**: Consistent API across iOS and Android
- **Memory efficient**: Process multi-GB files without memory issues

See [FILE_STREAM.md](./docs/FILE_STREAM.md) for complete documentation.

## 📋 Changes & Compatibility

### ✅ Mostly Backward Compatible!
The core API remains backward compatible - most existing code will work without changes!

### Required Dependencies
You'll need to add Nitro Modules as a peer dependency:
```json
{
  "react-native-nitro-modules": "^0.29.7"
}
```

### API Improvements (Non-Breaking)

#### Backward Compatible File Operations
The core file API remains **backward compatible**! You can still use the same API:

```typescript
// This still works exactly the same!
const content = await RNFS.readFile(path, 'utf8');
await RNFS.writeFile(path, content, 'utf8');
```

**Under the hood**: The native bridge now uses `ArrayBuffer` for better performance and smaller memory footprint, but encoding/decoding is handled transparently in JavaScript. No code changes required!

#### Download API - Fully Backward Compatible
The download API remains **100% backward compatible**:

```typescript
// Works exactly the same as v3.x!
const { jobId, promise } = RNFS.downloadFile({
  fromUrl: url,
  toFile: path,
  begin: (res) => { },
  progress: (res) => { }
});
```

**Internal improvement**: Under the hood, the download system now uses Nitro's event listeners for better performance, but the public API is unchanged.

### Breaking Type Changes

These changes may require code updates:

- **Timestamps as numbers**: `ReadDirItem` and `stat()` now return timestamps as numbers (milliseconds since epoch) instead of Date objects
  ```typescript
  // Before: res.mtime was a Date
  // After: res.mtime is a number (use new Date(res.mtime) if needed)
  const items = await RNFS.readDir(path);
  const date = new Date(items[0].mtime); // Convert if you need Date object
  ```

- **MediaStore `queryMediaStore` result structure changed** (Breaking - requires code changes):
  - Type renamed: `MediaStoreQueryResult` → `MediaStoreFile`
  - Property renamed: `contentUri` → `uri`
  - Additional fields added: `name`, `mimeType`, `size`, `dateAdded`, `dateModified`, `relativePath`

  ```typescript
  // Before (v3.x)
  const result = await RNFS.MediaStore.queryMediaStore({...});
  console.log(result.contentUri); // ❌ This will be undefined in v4.x

  // After (v4.x)
  const result = await RNFS.MediaStore.queryMediaStore({...});
  console.log(result.uri); // ✅ Use .uri instead of .contentUri
  // Now you also get additional metadata:
  console.log(result.name, result.size, result.mimeType);
  ```

  **Migration**: Replace all `result.contentUri` with `result.uri`

- **MediaStore type renames** (Breaking for TypeScript users):
  - `FileDescriptor` → `FileDescription`

- **Stricter types**: Hash algorithms and file protection types are now union types for better type safety

## 🎁 New Features

### Stream API
```typescript
import { createReadStream, createWriteStream, listenToReadStreamData } from 'react-native-fs2';

// Read large files efficiently
const stream = await createReadStream(path, { bufferSize: 8192 });
listenToReadStreamData(stream.streamId, (event) => {
  console.log(`Chunk ${event.chunk}: ${event.data.byteLength} bytes`);
});
await stream.start();

// Write large files with progress
const writeStream = await createWriteStream(path);
await writeStream.write(chunk1);
await writeStream.write(chunk2);
await writeStream.close();
```

### Enhanced MediaStore Support (Android)
MediaStore functionality remains available with improved type safety and performance.

### Improved Error Handling
Better error messages with platform-specific error codes and context.

## 🚀 Performance Improvements

- **Faster Native Calls**: JSI eliminates bridge serialization overhead
- **Reduced Memory Usage**: Streaming API enables processing large files with minimal memory
- **Better Threading**: Native operations properly managed on background threads
- **Optimized Buffer Management**: Native buffer pooling ready (see improvement docs)

## 📚 Documentation

New documentation added:
- [FILE_STREAM.md](./docs/FILE_STREAM.md) - Complete streaming API guide

## 🔧 Migration Guide

### 1. Install Dependencies
```bash
yarn add react-native-nitro-modules@^0.29.7
```

### 2. Update Imports
```typescript
import RNFS from 'react-native-fs2';
// All existing APIs remain under RNFS namespace

// Streaming APIs (new!) are separate exports
import { createReadStream, createWriteStream } from 'react-native-fs2';
```

### 3. Verify File Operations
Most file operations are backward compatible - no changes needed! The same API works:
```typescript
// These still work exactly the same
await RNFS.readFile(path, 'utf8');
await RNFS.writeFile(path, content, 'utf8');
await RNFS.readDir(path);
```

### 4. (Optional) Explore New Features
Check out the new capabilities:
- **File Streaming API** for efficient large file operations (see [FILE_STREAM.md](./docs/FILE_STREAM.md))
- **Better Performance** across all operations thanks to Nitro Modules

### 5. Test Key Areas
Since most APIs are backward compatible, focus testing on:
- Any code that uses `mtime`/`ctime` from `stat()` or `readDir()` (now numbers instead of Date)
- Download functionality (should work the same)
- MediaStore operations on Android (should work the same)

## 🐛 Known Issues

- Streaming API is in **beta** - please report issues

## 🙏 Acknowledgments

This major release builds upon the foundation of `react-native-fs` and leverages the incredible work of:
- [Nitro Modules](https://github.com/mrousavy/nitro) by Marc Rousavy
- The React Native community

## 📦 Package Info

- **Version**: 4.0.0
- **React Native**: >=0.80
- **Nitro Modules**: ^0.29.7

---

## Testing Checklist

- [ ] iOS build and runtime
- [ ] Android build and runtime  
- [ ] File read/write operations
- [ ] Download functionality
- [ ] Stream API (read/write)
- [ ] MediaStore operations (Android)
- [ ] Memory usage with large files
- [ ] Error handling across platforms

---

**Note**: This is a major version bump due to the architectural change and new peer dependency requirement. The API is mostly backward compatible with only minor type changes for timestamps. Most apps can upgrade with minimal changes!

