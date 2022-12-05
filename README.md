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
yarn add react-native-fs2
```

### Changelog
Changes can be found in [CHANGELOG.md](CHANGELOG.md)

### Usage
```ts
import RNFS from 'react-native-fs2';

console.log(await RNFS.getFSInfo());
```

#### mkdir

#### moveFile

#### copyFile

#### getFSInfo

#### getAllExternalFilesDirs

#### unlink

#### exists

#### stopDownload

#### resumeDownload

#### isResumable

#### completeHandlerIOS

#### readDir

#### readFile

#### read

#### hash

#### writeFile

#### appendFile

#### write

#### stat

#### downloadFile

#### touch

#### scanFile

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
