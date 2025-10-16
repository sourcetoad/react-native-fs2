# react-native-fs2
_A fork of [react-native-fs](https://github.com/itinance/react-native-fs) with a smaller footprint and fixes due to the upstream library seemingly being abandoned._

**Now powered by [Nitro Modules](https://github.com/mrousavy/nitro)** for superior performance and type safety! 🚀

### Why the fork?
This library intentional or not has become critical to the success of our mobile applications. We've noticed a few things that led to this fork:

 * The original library continuing to expand beyond a basic file system library.
 * Hundreds of open issues
 * Pull requests go unmerged
 * Tests that go untouched
 * Some edge case bugs that stay unresolved

We debated a few paths, but we felt it best to fork the project and make some major changes that will upset some.

 * We dropped Windows support.
 * We dropped methods specific to platforms.
 * We dropped upload support.

We will continue to support this library for as long as we use it.

## Features

- 🚀 **High Performance**: Powered by Nitro Modules with direct JSI bindings
- 📁 **File System Operations**: Complete file system access (read, write, copy, move, etc.)
- 🌊 **File Streaming** (Beta): Efficiently handle large files with streaming API
- 📱 **MediaStore Support**: Android MediaStore integration for media files
- ⬇️ **Downloads**: Background downloads with progress tracking
- 🔒 **Type Safe**: Full TypeScript support with end-to-end type safety
- 🎯 **Cross Platform**: iOS and Android support

### Installation
```bash
npm i --save react-native-fs2
# Peer dependency required
npm i --save react-native-nitro-modules
```

#### Supported React Native Versions
| react-native-fs2 | react-native |
|------------------|--------------|
| 4.x (nitro)      | >=0.80       |
| 3.0.x            | >=0.69       |

### Changelog
Changes can be found in [CHANGELOG.md](CHANGELOG.md)

### What's New in 4.x

- **Nitro Modules Architecture**: Complete rewrite using Nitro Modules for superior performance
- **File Streaming API**: New streaming capabilities for large file operations (see [FILE_STREAM.md](./docs/FILE_STREAM.md))
- **Better Type Safety**: End-to-end type safety from TypeScript to native code
- **ArrayBuffer Built-in**: Native ArrayBuffer support without additional dependencies
- **Backward Compatible API**: Most existing code works without changes!

> **Note**: v4.x requires `react-native-nitro-modules` as a peer dependency. See migration notes below.

## Usage
```ts
import RNFS from 'react-native-fs2';

console.log(await RNFS.getFSInfo());
```

### `mkdir`
```ts
// mkdir(filepath: string, options?: MkdirOptions): Promise<undefined>
await RNFS.mkdir(`FolderToCreate`);
```

 * Creates directory at `filepath` location.
 * Optionally include `MkdirOptions` with properties:
   * (iOS) - [NSURLIsExcludedFromBackupKey](https://developer.apple.com/documentation/foundation/nsurlisexcludedfrombackupkey)
   * (iOS) - [NSFileProtectionKey](https://developer.apple.com/documentation/foundation/nsfileprotectionkey)

### `moveFile`
```ts
// moveFile(filepath: string, destPath: string, options?: FileOptions): Promise<undefined>
await RNFS.moveFile('FileToMove', 'DestinationLocation')
```

* Moves file from `filepath` to `destPath`
* Optionally includes `FileOptions` with properties:
  * (iOS) - [NSFileProtectionKey](https://developer.apple.com/documentation/foundation/nsfileprotectionkey)

### `copyFile`
```ts
// copyFile(filepath: string, destPath: string, options?: FileOptions): Promise<undefined>
await RNFS.copyFile('FileToCopy', 'DestinationLocation')
```

* Copies file from `filepath` to `destPath`
* Optionally includes `FileOptions` with properties:
  * (iOS) - [NSFileProtectionKey](https://developer.apple.com/documentation/foundation/nsfileprotectionkey)

### `getFSInfo`
```ts
// getFSInfo(): Promise<FSInfoResult>
const fsInfo = await RNFS.getFSInfo()
```
* Returns an `FSInfoResult` object that contains information on the device storage space
* `FSInfoResult`
  * totalSpace: `number` -> The total amount of storage space on the device (in bytes).
  * freeSpace: `number` -> The amount of available storage space on the device (in bytes)

### `getAllExternalFilesDirs` (Android only)
```ts
// getAllExternalFilesDirs(): Promise<string[]>
const externalFileDirs = await RNFS.getAllExternalFilesDirs()
```
* Returns an `array` with the absolute paths to application-specific directories on all shared/external storage devices where the application can place persistent files it owns.

### `unlink`
```ts
// unlink(filepath: string): Promise<void>
await RNFS.unlink('FileToUnlink')
```
* Unlinks the item at `filepath`. If the item does not exist, an error will be thrown.
Also recursively deletes directories (works like Linux `rm -rf`).

### `exists`
```ts
// exists(filepath: string): Promise<boolean>
await RNFS.exists('File')
```
* Check if the item exists at `filepath`. If the item does not exist, return false.

### `completeHandlerIOS` (iOS Only)
```ts
// completeHandlerIOS(jobId: number): void
await RNFS.completeHandler('JobID')
```
*  Tell iOS you are done handling a completed download when using background downloads.


### `readDir`
```ts
// readDir(dirPath: string): Promise<ReadDirItem[]>
const dirItems = await RNFS.readDir('DirPath')
```
* Returns an `array` of `ReadDirItem` which are items that are present in the directory
* `ReadDirItem`
  * ctime: `number | undefined` -> The creation timestamp in milliseconds (iOS only)
  * mtime: `number` -> The last modified timestamp in milliseconds
  * name: `string` -> The name of the item
  * path: `string` -> The absolute path to the item
  * size: `number` -> Size in bytes
  * isFile: `boolean` -> Is the item a file?
  * isDirectory: `boolean` -> Is the item a directory?


### `readFile`
```ts
// readFile(filepath: string, encodingOrOptions?: EncodingOrOptions): Promise<string>
const fileData = await RNFS.readFile('DirPath', 'utf8')
```
* Reads the `filepath` and return the file `contents`
* Optionally includes `EncodingOrOptions` with values:
  * `'utf8'` (default) | `'base64'` (for binary files) | `'ascii'` | `'arraybuffer'`
  * ...fileoptions
* Note: `arraybuffer` support is built-in via Nitro Modules (no additional dependencies required)

### `read`
```ts
/*
  read(
    filepath: string,
    length: number = 0,
    position: number = 0,
    encodingOrOptions?: EncodingOrOptions
  ): Promise<string>
*/

const fileData = await RNFS.read('FileToRead', 0, 0, 'utf8')
```
* Reads bytes length from the given position of the file at `filepath` and returns the file `contents`.
* Optionally includes `EncodingOrOptions` with values:
  * `'utf8'` (default) | `'base64'` (for binary files) | `'ascii'`
  * ...fileoptions


### `hash`
```ts
// hash(filepath: string, algorithm: string): Promise<string>
const fileChecksum = await RNFS.hash('FileToHash', 'md5')
```
* Reads the `filepath` and returns its checksum as determined by algorithm, which can be one of the following `md5`  |  `sha1` | `sha224` | `sha256` | `sha384` | `sha512`.

### `writeFile`
```ts
// writeFile(filepath: string, contents: string, encodingOrOptions?: EncodingOrOptions): Promise<void>
await RNFS.write('FileToWrite', 'ContentsToWrite', 'utf8')
```
* Write the `contents` to `filepath`
* Optionally includes `EncodingOrOptions` with values:
  * `'utf8'` (default) | `'base64'` (for binary files) | `'ascii'`
  * ...fileoptions


### `appendFile`
```ts
// appendFile(filepath: string, contents: string, encodingOrOptions?: EncodingOrOptions): Promise<void>
await RNFS.appendFile('FileToWrite', 'ContentsToAppend', 'utf8')
```
* Append the `contents` to `filepath`
* Optionally includes `EncodingOrOptions` with values:
  * `'utf8'` (default) | `'base64'` (for binary files) | `'ascii'`
  * ...fileoptions


### `write`
```ts
// write(filepath: string, contents: string, position?: number, encodingOrOptions?: EncodingOrOptions): Promise<void>
await RNFS.write('FileToWrite', 'ContentsToWrite', -1, 'utf8')
```
* Write the `contents` to `filepath` at the given random access position. When position is undefined or -1 the contents is appended to the end of the file
* Optionally includes `EncodingOrOptions` with values:
  * `'utf8'` (default) | `'base64'` (for binary files) | `'ascii'`
  * ...fileoptions



### `stat`
```ts
// stat(filepath: string): Promise<StatResult>
const fileStats = await RNFS.stat('FilePath')
```
* Returns a `StatResult` object with statistics of the file
* `StatResult`
  * path: `string` -> The same as filepath argument
  * ctime: `number` -> The creation timestamp in milliseconds
  * mtime: `number` -> The last modified timestamp in milliseconds
  * size: `number` -> Size in bytes
  * mode: `number` -> UNIX file mode (iOS only)
  * originalFilepath: `string` -> Android: In case of content uri this is the pointed file path, otherwise is the same as path
  * isFile: () => `boolean` -> Is the file just a file?
  * isDirectory: () => `boolean` -> Is the file a directory?

### `downloadFile`
```ts
// downloadFile(options: DownloadFileOptions): { jobId: number, promise: Promise<DownloadResult> }
const downloadResults = await RNFS.downloadFile('FilePath')
```
* Downloads file from `options.fromUrl` to `options.toFile`.  Will overwrite any previously existing file.
<br/><br/>
* Include `DownloadFileOptions` with properties
  * fromUrl: `string`         -> URL to download file from
  * toFile: `string`           -> Local filesystem path to save the file to
  * headers?: `Headers`        -> An object of headers to be passed to the server
  * background?: `boolean`     -> Continue the download in the background after the app terminates (iOS only)
  * discretionary?: `boolean`  -> Allow the OS to control the timing and speed of the download to improve perceived performance  (iOS only)
  * cacheable?: `boolean`
  * progressInterval?: `number`
  * progressDivider?: `number`
  * begin?: `(res: DownloadBeginCallbackResult) => void;` -> Note: it is required when progress prop provided
  * progress?: `(res: DownloadProgressCallbackResult) => void`;
  * resumable?: `() => void`    -> only supported on iOS
  * connectionTimeout?: `number` -> only supported on Android
  * readTimeout?: `number   `    -> supported on Android and iOS
  * backgroundTimeout?: `number` -> Maximum time (in milliseconds) to download an entire resource (iOS only, useful for timing out background downloads)
<br/><br/>
* Returns `DownloadResult`
  * jobId: `number`          -> The download job ID, required if one wishes to cancel the download. See `stopDownload`.
  * statusCode: `number`     -> The HTTP status code
  * bytesWritten: `number`   -> The number of bytes written to the file

### `stopDownload`
```ts
// stopDownload(jobId: number): void
await RNFS.stopDownload('JobID'): void
```
* Abort the current download job with this ID. The partial file will remain on the filesystem.

### `resumeDownload` (iOS Only)
```ts
// resumeDownload(jobId: number): void
await RNFS.resumeDownload('JobID'): void
```
* Resume the current download job with this ID

### `isResumable` (iOS Only)
```ts
// isResumable(jobId: number): Promise<bool>
if (await RNFS.isResumable('JobID')) {
    RNFS.resumeDownload('JobID')
}
```
* Check if the the download job with this ID is resumable.

### `touch`
```ts
// touch(filepath: string, mtime?: Date, ctime?: Date): Promise<void>
await RNFS.touch('FilePath', Date, Date)
```
* Sets the modification timestamp `mtime` and creation timestamp `ctime` of the file at `filepath`. Setting `ctime` is only supported on iOS, Android always sets both timestamps to `mtime`.

### `scanFile` (Android Only)
```ts
// scanFile(path: string): Promise<string[]>
await RNFS.scanFile('FilePath', Date, Date)
```
* Scan the file using [Media Scanner](https://developer.android.com/reference/android/media/MediaScannerConnection).

# File Streaming API (Beta)

React-native-fs2 now provides powerful file streaming capabilities for efficiently reading and writing large files without loading entire content into memory.

### `createReadStream`
```ts
import { createReadStream, listenToReadStreamData, listenToReadStreamProgress, listenToReadStreamEnd } from 'react-native-fs2';

const stream = await createReadStream('/path/to/large-file.dat', {
  bufferSize: 8192 // 8KB chunks
});

// Listen for data chunks
const unsubData = listenToReadStreamData(stream.streamId, (event) => {
  console.log(`Chunk ${event.chunk}: ${event.data.byteLength} bytes`);
});

// Listen for progress
const unsubProgress = listenToReadStreamProgress(stream.streamId, (event) => {
  console.log(`Progress: ${event.progress * 100}%`);
});

// Listen for completion
const unsubEnd = listenToReadStreamEnd(stream.streamId, (event) => {
  console.log('Stream finished');
  unsubData();
  unsubProgress();
  unsubEnd();
});

await stream.start();
```

### `createWriteStream`
```ts
import { createWriteStream, listenToWriteStreamProgress, listenToWriteStreamFinish } from 'react-native-fs2';

const stream = await createWriteStream('/path/to/output-file.dat', {
  append: false,
  createDirectories: true
});

// Listen for progress
const unsubProgress = listenToWriteStreamProgress(stream.streamId, (event) => {
  console.log(`Written: ${event.bytesWritten} bytes`);
});

// Listen for completion
const unsubFinish = listenToWriteStreamFinish(stream.streamId, (event) => {
  console.log('Write completed:', event.bytesWritten, 'bytes');
  unsubProgress();
  unsubFinish();
});

// Write data in chunks
await stream.write(chunk1);
await stream.write(chunk2);
await stream.close();
```

**For complete streaming API documentation, see [FILE_STREAM.md](./docs/FILE_STREAM.md)**

# MediaStore

### RNFS2 can now interact with the MediaStore on Android. This allows you to add, delete, and update media files in the MediaStore. 

### Inspiration for this feature came from [react-native-blob-util](https://github.com/RonRadtke/react-native-blob-util/wiki/MediaStore/)

### This feature is only available on Android targeting API 29 or higher. And may require the following permissions:

```xml
<!-- Required only if your app needs to access images or photos that other apps created. -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />

<!-- Required only if your app needs to access videos that other apps created. -->
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />

<!-- Required only if your app needs to access audio files that other apps created. -->
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>

<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />
```

## Available Methods

### `createMediaFile`

* Creates a new media file in the MediaStore with the given `mimeType`. This will not create a file on the filesystem, but will create a reference in the MediaStore.

```ts
// createMediaFile(fileDescriptor: FileDescriptor, mediatype: MediaCollections): Promise<string>

const fileDescriptor = { name: 'sample', parentFolder: 'MyAppFolder', mimeType: 'image/png' }

const contentURI = await RNFS.MediaStore.createMediaFile(fileDescriptor,  RNFS.MediaStore.MEDIA_IMAGE)
```

### `updateMediaFile`

* Updates the media file in the MediaStore

```ts
// updateMediaFile(uri: string, fileDescriptor: FileDescriptor, mediatype: MediaCollections): Promise<string>

const contentURI = 'content://media/external/images/media/123'
const fileDescriptor = { name: 'sample-updated-filename', parentFolder: 'MyAppFolder', mimeType: 'image/png' }

const contentURI = await RNFS.MediaStore.updateMediaFile(contentURI, fileDescriptor, RNFS.MediaStore.MEDIA_IMAGE)
```

### `writeToMediaFile`

* Writes data to a media file in the MediaStore with the given `mimeType`.

```ts
// writeToMediaFile((uri: string, path: string): Promise<void>

await RNFS.MediaStore.writeToMediaFile('content://media/external/images/media/123', '/path/to/image/imageToWrite.png')
```

### `copyToMediaStore`

* Copies the file at `filepath` to the MediaStore with the given `mimeType`.

```ts
// copyToMediaStore(fileDescriptor: filedescriptor, mediatype: MediaCollections, path: string): Promise<string>

const fileDescriptor = { name: 'sample', parentFolder: 'MyAppFolder', mimeType: 'image/png' }

const contentURI = await RNFS.MediaStore.copyToMediaStore(fileDescriptor,  RNFS.MediaStore.MEDIA_IMAGE, '/path/to/image/imageToCopy.png')
```

### `queryMediaStore`

* Queries the MediaStore for media files with the given `searchOptions`.

```ts
// queryMediaStore(searchOptions: MediaStoreSearchOptions): Promise<MediaStoreQueryResult>

await RNFS.MediaStore.queryMediaStore({
  uri: 'content://media/external/images/media/123',
  fileName: ''
  relativePath: ''
  mediaType: RNFS.MediaStore.MEDIA_IMAGE;
})

// or
await RNFS.MediaStore.queryMediaStore({
  uri: '',
  fileName: 'image.png'
  relativePath: 'MyAppFolder'
  mediaType: RNFS.MediaStore.MEDIA_IMAGE;
})
```

### `deleteFromMediaStore`

* Deletes the media file at `uri` from the MediaStore.

```ts
// deleteFromMediaStore(uri: string): Promise<boolean>

await RNFS.MediaStore.deleteFromMediaStore('content://media/external/images/media/123')
```

## FileDescriptor
```ts
type FileDescriptor = { 
  name: string; 
  parentFolder: string; 
  mimeType: string 
};
```

## MediaStoreSearchOptions
```ts
type MediaStoreSearchOptions = { 
  uri: string; 
  fileName: string; 
  relativePath: string; 
  mediaType: MediaCollections 
};
```

## MediaStoreQueryResult
```ts
type MediaStoreQueryResult = { 
  contentUri: string;
};
```

## MediaStore Collections
 * `MediaStore.MEDIA_AUDIO` - Audio media collection
 * `MediaStore.MEDIA_IMAGE` - Image media collection
 * `MediaStore.MEDIA_VIDEO` - Video media collection
 * `MediaStore.MEDIA_DOWNLOAD` - Download media collection

## Constants

#### Common
 * `CachesDirectoryPath` - Absolute path to cache directory.
 * `DocumentDirectoryPath` - Absolute path to the document directory.
 * `TemporaryDirectoryPath` - Absolute path to temporary directory (cache on Android).

#### Android
 * `ExternalCachesDirectoryPath` - Absolute path to the external cache directory.
 * `ExternalDirectoryPath` - Absolute path to external shared directory.
 * `ExternalStorageDirectoryPath` - Absolute path to the external shared storage directory.
 * `DownloadDirectoryPath` - Absolute path to the download directory.

> Please be sure to request needed permissions via [PermissionsAndroid](https://reactnative.dev/docs/permissionsandroid).

#### iOS
 * `LibraryDirectoryPath` - Absolute path to [NSLibraryDirectory](https://developer.apple.com/documentation/foundation/nssearchpathdirectory/nslibrarydirectory)
 * `MainBundlePath` - Absolute path to main bundle directory.

## Migrating from v3.x to v4.x

The v4.x release brings significant improvements with minimal breaking changes. Most apps can upgrade with little to no code changes!

### Installation

1. **Install peer dependency:**
```bash
npm install react-native-nitro-modules
# or
yarn add react-native-nitro-modules
```

2. **Update react-native-fs2:**
```bash
npm install react-native-fs2@latest
# or
yarn add react-native-fs2@latest
```

### Breaking Changes

#### Timestamps are now numbers
The only significant breaking change is that timestamps are now returned as numbers (milliseconds since epoch) instead of Date objects:

```typescript
// v3.x
const items = await RNFS.readDir(path);
const date = items[0].mtime; // Date object

// v4.x
const items = await RNFS.readDir(path);
const timestamp = items[0].mtime; // number
const date = new Date(items[0].mtime); // Convert to Date if needed
```

This affects:
- `readDir()` - `ctime` and `mtime` fields
- `stat()` - `ctime` and `mtime` fields

### What Still Works

✅ **All core file operations** - No changes required:
```typescript
await RNFS.readFile(path, 'utf8');
await RNFS.writeFile(path, content, 'utf8');
await RNFS.copyFile(src, dest);
await RNFS.moveFile(src, dest);
await RNFS.unlink(path);
// ... all other operations work the same!
```

✅ **Download API** - Backward compatible:
```typescript
const { jobId, promise } = RNFS.downloadFile({
  fromUrl: url,
  toFile: path,
  begin: (res) => { },
  progress: (res) => { }
});
```

✅ **MediaStore** (Android) - Works the same

### New Features to Explore

Once migrated, you can optionally explore:

- **File Streaming API**: For efficient large file operations (see [FILE_STREAM.md](./docs/FILE_STREAM.md))
- **Better Performance**: Automatic via Nitro Modules architecture
- **Enhanced Type Safety**: Full TypeScript support throughout

### Need Help?

If you encounter issues during migration:
1. Check the [CHANGELOG.md](./CHANGELOG.md) for detailed changes
2. Review [FILE_STREAM.md](./docs/FILE_STREAM.md) for streaming API
3. Open an issue on [GitHub](https://github.com/sourcetoad/react-native-fs2/issues)
