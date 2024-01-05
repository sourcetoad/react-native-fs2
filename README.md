# react-native-fs2
_A fork of [react-native-fs](https://github.com/itinance/react-native-fs) with a smaller footprint and fixes due to the upstream library seemingly being abandoned._

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

### Installation
```bash
npm i --save react-native-fs2
```

#### Supported React Native Versions
| react-native-fs2 | react-native |
|------------------|--------------|
| 3.0.x            | >=0.69       |

### Changelog
Changes can be found in [CHANGELOG.md](CHANGELOG.md)

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
* Retuns an `array` of `ReadDirItem` which are items that are present in the directory
* `ReadDirItem`
  * ctime: `Date | undefined` -> The creation date of the file (iOS only)
  * mtime: `Date | undefined` -> The last modified date of the file
  * name: `string` -> The name of the item
  * path: `string` -> The absolute path to the item
  * size: `number` -> Size in bytes
  * isFile: () => `boolean` -> Is the file just a file?
  * isDirectory: () => `boolean` -> Is the file a directory?


### `readFile`
```ts
// readFile(filepath: string, encodingOrOptions?: EncodingOrOptions): Promise<string>
const fileData = await RNFS.readFile('DirPath', 'utf8')
```
* Reads the `filepath` and return the file `contents`
* Optionally includes `EncodingOrOptions` with values:
  * `'utf8'` (default) | `'base64'` (for binary files) | `'ascii'`
  * ...fileoptions


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
* Retuns an `array` of `StatResult` which are `statistics` of the `file`
* `StatResult`
  * path: `string` -> The same as filepath argument
  * ctime: `date` -> The creation date of the file
  * mtime: `date` -> The last modified date of the file
  * size: `number` -> Size in bytes
  * mode: `number` -> UNIX file mode
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


### Constants

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
