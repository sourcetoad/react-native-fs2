# Upgrading

## Migrating from v3.x to v4.x

The v4.x release rewrites the native bridge on [Nitro Modules](https://github.com/mrousavy/nitro).
Most call sites are unchanged, but there are real breaking changes — read this document before
upgrading.

### Installation

1. **Install peer dependency:** - `react-native-nitro-modules`

Requires React Native `>=0.82.0` and `react-native-nitro-modules@^0.37.1`.

### Breaking Changes

#### Timestamps are numbers, not Dates

```typescript
// v3.x
const items = await RNFS.readDir(path);
const date = items[0].mtime; // Date object

// v4.x
const items = await RNFS.readDir(path);
const timestamp = items[0].mtime; // number (ms since epoch)
const date = new Date(items[0].mtime);
```

Affects `ctime` and `mtime` on both `readDir()` and `stat()`.

#### `MediaStore` moved to a named export

`RNFS.MediaStore` is gone. Reading it off the default export gives `undefined`, and calling a method on it throws. Import it directly — see the [MediaStore](./README.md#mediastore) section of the README.

```typescript
// v3.x
import RNFS from 'react-native-fs2';
await RNFS.MediaStore.queryMediaStore({ ... });

// v4.x
import { MediaStore } from 'react-native-fs2';
await MediaStore.queryMediaStore({ ... });
```

#### `queryMediaStore` result shape changed, and can be `undefined`

- Type renamed `MediaStoreQueryResult` → `MediaStoreFile`, and `FileDescriptor` → `FileDescription`.
- Property renamed `contentUri` → `uri`. New fields: `name`, `mimeType`, `size`, `dateAdded`, `dateModified`, `relativePath`.
- The return type is now `Promise<MediaStoreFile | undefined>` — a query that matches nothing resolves `undefined` instead of rejecting.

#### `MkdirOptions` keys renamed

`NSURLIsExcludedFromBackupKey` → `excludedFromBackup`, `NSFileProtectionKey` → `fileProtection`. Passed inline this is a compile error — TypeScript rejects the unknown key and suggests the new name. It only slips through silently if the options object reaches the call as a separately-typed variable, so check those by hand.

#### `FileOptions.NSFileProtectionKey` renamed to `fileProtection`

`writeFile`, `moveFile` and `copyFile` still accept iOS file protection, as they did in 3.x — `writeFile` through its encoding argument, `moveFile`/`copyFile` through a third parameter, but the key is renamed and its type narrowed from `string` to the `FileProtectionType` union.

```typescript
// v3.x
await RNFS.writeFile(path, data, { encoding: 'utf8', NSFileProtectionKey: 'NSFileProtectionComplete' });
await RNFS.moveFile(from, to, { NSFileProtectionKey: 'NSFileProtectionComplete' });

// v4.x
await RNFS.writeFile(path, data, { encoding: 'utf8', fileProtection: 'NSFileProtectionComplete' });
await RNFS.moveFile(from, to, { fileProtection: 'NSFileProtectionComplete' });
```

Passed inline the old key is a compile error. It only slips through silently if the options object reaches the call as a separately-typed variable, so check those by hand.

#### `moveFile` and `copyFile` overwrite an existing destination on iOS

In 3.x these failed on iOS if something already existed at `destPath`, while Android
overwrote it. Both platforms now overwrite.

```typescript
// v3.x on iOS: rejects if dest exists. On Android: overwrites.
// v4.x on both: overwrites, destroying whatever was at dest.
await RNFS.copyFile(src, dest);
```

This is silent — nothing warns you, and the previous contents are gone. If you relied on the iOS rejection to avoid clobbering a file, check with `exists()` first:

```typescript
if (await RNFS.exists(dest)) throw new Error('refusing to overwrite');
await RNFS.copyFile(src, dest);
```

Only a *successful* call overwrites. If the source does not exist the call rejects and the destination is left exactly as it was:

```typescript
await RNFS.writeFile(dest, 'important', 'utf8');
await RNFS.moveFile('/does/not/exist', dest); // rejects with ENOENT
await RNFS.readFile(dest, 'utf8'); // still 'important'
```

A directory destination is also handled now: passing one appends the source filename rather than failing, and missing parent directories are created.

#### `downloadFile`: the `resumable` callback is now `canBeResumed`

```typescript
// v3.x
RNFS.downloadFile({ fromUrl, toFile, resumable: () => {} });

// v4.x
RNFS.downloadFile({ fromUrl, toFile, canBeResumed: (event) => {} });
```

An unmigrated `resumable: () => {}` is ignored — it never fires.

#### `downloadFile` only writes `toFile` on a 2xx response

A non-2xx response leaves `toFile` untouched — an existing file there is not replaced by the error body — and the promise resolves with the real status code and `bytesWritten: 0`. Check `statusCode` before treating the download as successful:

```typescript
const { promise } = RNFS.downloadFile({ fromUrl, toFile });
const { statusCode, bytesWritten } = await promise;

if (statusCode !== 200) {
  // toFile was not written; whatever was there before is intact.
}
```

This holds whether the server declares a `Content-Length`.

#### `completeHandlerIOS` was removed

There is no replacement in 4.0. Background downloads (`background: true`) still start on iOS, but the library cannot invoke the system completion handler when one finishes while the app is suspended. Treat background downloads as unsupported in 4.0 if you relied on that handler.

#### Constants are `''`, not `null` or `undefined`, where they do not apply

Every constant is a `string` and is `''` on the platform that does not provide it. In 3.x these were a mix of `null` (Android's external paths) and `undefined` (keys missing from the native map entirely), so a `=== null` or `=== undefined` check needs updating:

```typescript
// v3.x
if (RNFS.ExternalStorageDirectoryPath !== null) { }

// v4.x — '' is falsy, so a plain truthiness check works on both
if (RNFS.ExternalStorageDirectoryPath) { }
```

### Need Help?

If you encounter issues during migration:
1. Check the [CHANGELOG.md](./CHANGELOG.md) for detailed changes
2. Review [FILE_STREAM.md](./docs/FILE_STREAM.md) for streaming API
3. Open an issue on [GitHub](https://github.com/sourcetoad/react-native-fs2/issues)
