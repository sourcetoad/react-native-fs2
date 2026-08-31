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

This is a major release with **real breaking changes**. Most call sites are unchanged, but
several are not, and two of them fail silently rather than throwing. Read this section before
upgrading.

### Required Dependencies

Nitro Modules becomes a peer dependency:

```json
{
  "react-native-nitro-modules": "^0.37.0"
}
```

Also requires React Native `>=0.82.0`.

### Breaking Changes

| Change | What breaks | How it fails |
|---|---|---|
| Timestamps are `number` (ms since epoch), not `Date`, on `readDir()` and `stat()` | `items[0].mtime.getFullYear()` | Throws |
| `MediaStore` moved from the default export to a named export | `RNFS.MediaStore.…` | Throws — `RNFS.MediaStore` is `undefined` |
| `queryMediaStore` returns `MediaStoreFile \| undefined`; a query matching nothing resolves `undefined` instead of rejecting | `try/catch` around a not-found query | Silent — the `catch` never runs |
| `MediaStoreQueryResult` → `MediaStoreFile`, `FileDescriptor` → `FileDescription`, `contentUri` → `uri` | Type imports and `result.contentUri` | Type error / `undefined` |
| `MkdirOptions` keys renamed: `NSURLIsExcludedFromBackupKey` → `excludedFromBackup`, `NSFileProtectionKey` → `fileProtection` | `mkdir(path, { NSFileProtectionKey: … })` | Type error on a literal (`TS2561`); **silent** via a pre-typed variable |
| `FileOptions.NSFileProtectionKey` renamed to `fileProtection`, and now accepted by `writeFile` too | `copyFile(a, b, { NSFileProtectionKey: … })` | Type error on a literal; **silent** via a pre-typed variable |
| `downloadFile`: master's `resumable` **callback** is now `canBeResumed` | `resumable: () => {}` | **Silent** — the callback never fires |
| `completeHandlerIOS` removed | `RNFS.completeHandlerIOS(jobId)` | Throws |
| Hash algorithms and file protection values are union types now | Passing an arbitrary string | Type error |

The ones marked **silent** are worth grepping for before you upgrade. Note that the renamed
option keys only fail loudly when passed as an object literal — TypeScript rejects the unknown
key and suggests the new name. An options object that reaches the call as a separately-typed
variable is accepted and the key dropped, so check those by hand.

#### `completeHandlerIOS` and background downloads

There is no replacement in 4.0. `background: true` still creates a background
`URLSession` on iOS, but the library has no way to invoke the system completion handler when
a download finishes while the app is suspended. If you depend on that, treat background
downloads as unsupported in 4.0.

### Not Breaking (despite what you may expect)

- **`isFile()` / `isDirectory()` are still methods** on both `readDir()` items and `stat()`
  results, matching 3.x. An earlier cut of this branch returned plain booleans from
  `readDir`, which broke `items[0].isFile()`; that has been reverted to the 3.x shape.
- **`MainBundlePath` is still exported.** It was missing from an earlier cut of this branch.
- **`downloadFile` request headers work.** `headers` was not reaching native in an earlier
  cut; it does now.

### File Operations

The core file API is unchanged:

```typescript
const content = await RNFS.readFile(path, 'utf8');
await RNFS.writeFile(path, content, 'utf8');
```

**Under the hood**: the native bridge now uses `ArrayBuffer`; encoding and decoding happen in
JavaScript. No code changes required.

### Download API

```typescript
const { jobId, promise } = RNFS.downloadFile({
  fromUrl: url,
  toFile: path,
  headers: { Authorization: 'Bearer ...' },
  begin: (res) => { },
  progress: (res) => { }
});
```

Unchanged except for the `resumable` → `canBeResumed` rename above. Note that `jobId` is no
longer part of the options type — the library allocates it and hands it back to you, as in
3.x.

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
MediaStore functionality remains available with improved type safety and performance. Note it
is a **named export** now:

```typescript
import { MediaStore } from 'react-native-fs2';

const result = await MediaStore.queryMediaStore({ ... });
console.log(result?.uri); // `contentUri` in 3.x; can be undefined when nothing matches
```

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
yarn add react-native-nitro-modules@^0.37.0
```

### 2. Update Imports
```typescript
import RNFS from 'react-native-fs2';
// Core file APIs remain under the RNFS default export

// MediaStore is a named export now — RNFS.MediaStore no longer exists
import { MediaStore } from 'react-native-fs2';

// Streaming APIs (new!) are separate exports
import { createReadStream, createWriteStream } from 'react-native-fs2';
```

### 3. Grep for the silent breakages
These two do not throw — they just stop doing anything:
```bash
grep -rn "NSFileProtectionKey\|NSURLIsExcludedFromBackupKey" src/   # renamed MkdirOptions keys
grep -rn "resumable:" src/                                          # now canBeResumed
```

### 4. Verify File Operations
Core file operations are unchanged:
```typescript
await RNFS.readFile(path, 'utf8');
await RNFS.writeFile(path, content, 'utf8');
await RNFS.readDir(path);
```

### 5. (Optional) Explore New Features
- **File Streaming API** for efficient large file operations (see [FILE_STREAM.md](./docs/FILE_STREAM.md))
- **Better Performance** across all operations thanks to Nitro Modules

### 6. Test Key Areas
- `mtime`/`ctime` from `stat()` or `readDir()` — now numbers, not Dates
- Every `RNFS.MediaStore.*` call site — these now throw
- `mkdir` calls that passed `NSFileProtectionKey` or `NSURLIsExcludedFromBackupKey`
- `downloadFile` calls that passed a `resumable` callback
- `queryMediaStore` calls that relied on a rejection when nothing matched
- Background downloads on iOS, if you used `completeHandlerIOS`

## 🐛 Known Issues / Limitations

- The streaming API is **beta** — the exported functions carry `@beta` JSDoc and may change
  without a major bump.
- Stream event listeners are **single-subscriber**: the native maps hold one callback per
  (stream, event), so a second `listenTo*` for the same stream replaces the first. Do not
  subscribe to a stream that `copyFileWithProgress` or `processFileInChunks` is driving.
- `background: true` downloads on iOS cannot signal completion — see `completeHandlerIOS`
  above.
- `moveFile`/`copyFile` have no `options` parameter; the iOS `NSFileProtectionKey` option is
  unavailable on them.
- iOS MediaStore methods are deliberate no-ops that reject with `ENOTSUP:` — MediaStore is
  Android-only.

## 🙏 Acknowledgments

This major release builds upon the foundation of `react-native-fs` and leverages the incredible work of:
- [Nitro Modules](https://github.com/mrousavy/nitro) by Marc Rousavy
- The React Native community

## 📦 Package Info

- **Version**: 4.0.0
- **React Native**: >=0.82.0
- **Nitro Modules**: ^0.37.0

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

**Note**: This is a major version bump for an architectural change, a new peer dependency, and
the breaking changes listed above. Most apps will need small changes; the two silent ones
(renamed `MkdirOptions` keys, `resumable` → `canBeResumed`) are worth grepping for even if
everything appears to work after upgrading.

