# API comparison — `react-native-fs2` 3.x (master) vs 4.x (Nitro)

Every public export on both sides, compared. Built by reading `master:src/index.ts`,
`master:src/types.ts`, `master:README.md`, `master:ios/RNFSManager.m`,
`master:android/.../RNFSManager.java`, `master:android/.../RNFSMediaStoreManager.java`,
`src/index.ts`, `src/types.ts`, `src/_mediastore.ts`, `src/_filestream.ts`, the three
`.nitro.ts` specs, `ios/*.swift`, `android/.../com/margelo/nitro/fs2/**` and the regenerated
`nitrogen/generated/**`.

**Every claim about native behaviour was checked against native code on both platforms and
both versions**, not inferred from the TypeScript. Where 3.x's declared type and 3.x's
implementation disagree, both are stated — `NativeModules.RNFSManager` is typed `any` on
master, so master's types were never checked against master's own code and several are
simply wrong.

**Legend**

| Mark | Meaning |
|---|---|
| ✅ | unchanged in signature *and* observable behaviour on both platforms |
| 🔁 | changed, but source-compatible |
| ⚠️ | breaking, and something tells you — a compile error, or a throw at the call site |
| 💥 | breaking and **silent**: it compiles, it runs, and it does the wrong thing |
| ➕ | new in 4.x |
| ❌ | removed |

A note on 💥, because it is easy to over-apply. TypeScript's excess-property check fires on
**object literals**, so a renamed option key passed inline (`mkdir(p, { NSFileProtectionKey: … })`)
is a compile error, not a silent drop. Those are marked ⚠️. They only become silent if the
options object reaches the call as a pre-typed variable, or the caller is untyped JS. 💥 is
reserved for changes no amount of type-checking will catch.

---

## 1. Directory and path operations

| Function | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| `mkdir` | `mkdir(filepath: string, options?: MkdirOptions): Promise<undefined>` | `mkdir(filepath: string, options?: MkdirOptions): Promise<void>` | ⚠️ `MkdirOptions` keys renamed: `NSURLIsExcludedFromBackupKey` → `excludedFromBackup`, `NSFileProtectionKey` → `fileProtection`. Passed as an object literal this is a compile error (`TS2561`, and TS suggests `fileProtection`); passed as a widened variable it is silently ignored. `fileProtection` is now a union (`FileProtectionType`) rather than `string`. Return type `undefined` → `void` is cosmetic. **Android is unaffected either way** — master's Java `mkdir` accepted the options map and never read it (`master:RNFSManager.java:411-425`), and 4.x Android likewise ignores it (`RNFSManager.kt:371-379`), so both keys have always been iOS-only. `excludedFromBackup` accepts `false` as well as `true`: 3.x checked only that the key was present and forwarded its value (`master:ios/RNFSManager.m:249-251`), and 4.x now does the same (`ios/Fs2.swift:142-146`). It briefly gated on `true`, which made the flag one-way; fixed on this branch. |
| `moveFile` | `moveFile(filepath, destPath, options?: FileOptions): Promise<undefined>` | `moveFile(filepath, destPath): Promise<void>` | ⚠️ Third parameter dropped; fails as a TS arity error. Master's iOS **did** honour `NSFileProtectionKey` here (`master:ios/RNFSManager.m:418-425`), so this is a real loss, not a dead option. Deliberate — `MIGRATION_CHECKLIST.md:18` records it as "Options initially omitted", implying intent to restore. |
| `copyFile` | `copyFile(filepath, destPath, options?: FileOptions): Promise<undefined>` | `copyFile(filepath, destPath): Promise<void>` | ⚠️ Same as `moveFile` (`master:ios/RNFSManager.m:446-453`). |
| `moveFile` / `copyFile` — destination handling | iOS: **fails** if the destination exists (`copyItemAtPath`/`moveItemAtPath` with no pre-removal). Android: overwrites (`getOutputStream(dest, false)`, `master:RNFSManager.java:322`) | Both platforms **overwrite**: the destination is removed first (`ios/Fs2.swift:371-373`, `ios/Fs2.swift:423-425`) | 💥 Platform parity was fixed by making iOS match Android, so iOS callers who relied on the copy **failing** rather than clobbering an existing file now lose that file. Nothing warns you. Deliberate rather than accidental — `MIGRATION_CHECKLIST.md:19` records the target behaviour as "Handles overwrite and dest as dir". 4.x also newly resolves a directory destination by appending the source basename (`ios/Fs2.swift:356-359`, `ios/Fs2.swift:408-411`) and creates missing parent directories (`ios/Fs2.swift:363-365`) — neither is master behaviour. |
| `unlink` | `unlink(filepath: string): Promise<void>` | `unlink(filepath: string): Promise<void>` | 🔁 **Now consistent; master's two platforms never agreed.** Master iOS rejected `ENOENT` for a missing path (`master:ios/RNFSManager.m:213-214`). Master **Android** threw a bare `Exception("File does not exist")` (`master:RNFSManager.java:389`) which the reject helper turned into `promise.reject(null, …)` (`master:RNFSManager.java:618`) — code `null`, no `ENOENT` anywhere, so 3.x Android code matching on `ENOENT` never worked. In 4.x both platforms reject `ENOENT` (`ios/Fs2.swift:183-187`, `RNFSManager.kt:357`) — iOS briefly resolved instead, on an incorrect code comment claiming master did not throw; fixed on this branch. Net effect versus 3.x: iOS is unchanged, and Android's error gained the `ENOENT` code and prefix it always should have had. 4.x Android also resolves `content://` paths before deleting (`RNFSManager.kt:356`) where master used the raw string (`master:RNFSManager.java:387`), so `unlink` on a content URI now deletes the underlying file instead of failing. |
| `exists` | `exists(filepath: string): Promise<boolean>` | `exists(filepath: string): Promise<boolean>` | 💥 **on Android, for `content://` paths only.** iOS is unchanged. Master's Android checked `new File(filepath).exists()` with no URI resolution (`master:RNFSManager.java:206-214`), so `exists('content://…')` was always `false`. 4.x routes through `getOriginalFilepath` (`RNFSManager.kt:158`), which resolves a content URI to its real path via `MediaStore.Images.Media.DATA` (`RNFSManager.kt:62-78`) — so the same call can now return `true`. An improvement, but if you used `exists()` to test "is this a plain filesystem path", it no longer answers that question. Plain paths behave identically. |
| `readDir` | `readDir(dirPath: string): Promise<ReadDirItem[]>` | `readDir(dirPath: string): Promise<ReadDirItem[]>` | ⚠️ Same signature, changed item shape — see `ReadDirItem` in section 7. `isFile()`/`isDirectory()` are still **methods**. `ctime`/`mtime` changed from `Date` to milliseconds since the epoch — see below. `item.mtime.getTime()` is a compile error, so this is caught rather than silent. |

### Timestamps: `Date` → milliseconds

`readDir()` and `stat()` in 3.x returned **`Date` objects**. In 4.x they return **numbers in
milliseconds since the epoch**, so `new Date(item.mtime)` reconstructs the 3.x value.

| | master (3.x) | nitro (4.x) |
|---|---|---|
| native emits | seconds (`master:ios/RNFSManager.m:97-98`, which formats via `master:ios/RNFSManager.m:663`; `master:RNFSManager.java:346`, `master:RNFSManager.java:371-372`) | seconds (`ios/Fs2.swift:238-239`, `ios/Fs2.swift:276-277`; `RNFSManager.kt:322-326`, `RNFSManager.kt:346-347`) |
| JS layer | multiplies by 1000, wraps in `new Date()` (`master:src/index.ts:209-210`, `master:src/index.ts:224-225`) | multiplies by 1000 (`src/index.ts:133-134`, `src/index.ts:145-146`) |
| you receive | `Date` | `number`, **milliseconds** |

Both natives emit whole seconds, on both versions — that is a Nitro-struct detail, documented
at `src/nitro/Fs2.nitro.ts:9-12`, not something a caller sees. The conversion happens in the JS
wrapper exactly where 3.x did it.

```ts
// 3.x
const d = items[0].mtime                 // Date

// 4.x
const d = new Date(items[0].mtime)       // same instant
items[0].mtime > Date.now()              // works
```

`item.mtime.getTime()` is a compile error, so any 3.x call site treating the value as a `Date`
is caught by the compiler rather than silently misreading it. A missing `ctime` stays
`undefined` rather than becoming `0` — Android's `readDir` does not populate it
(`Fs2.kt:138`).

## 2. File read and write

| Function | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| `readFile` | `readFile(filepath, encodingOrOptions?): Promise<string \| ArrayBuffer>` | `readFile(filepath, encodingOrOptions?): Promise<string \| ArrayBuffer>` | 🔁 Signature identical. Master returned base64 from native and decoded in JS; 4.x returns an `ArrayBuffer` from native directly. **`arraybuffer` no longer needs `react-native-blob-jsi-helper`** — master required that optional peer dep and went via `fetch` + `Blob` (`master:src/index.ts:100-127`); 4.x reads the buffer natively. |
| `read` | `read(filepath, length?, position?, encodingOrOptions?): Promise<string>` | `read(filepath, length?, position?, encodingOrOptions?): Promise<string \| ArrayBuffer>` | 🔁 Widened return type. On master, `read(p, n, 0, 'arraybuffer')` **threw** `Invalid encoding type "arraybuffer"` from the JS decoder (`master:src/index.ts:97`); 4.x returns the buffer. Existing string callers are unaffected apart from needing a narrowing if they were typed `string` exactly. |
| `writeFile` | `writeFile(filepath, contents: string, encodingOrOptions?): Promise<void>` | `writeFile(filepath, contents: string, encodingOrOptions?): Promise<void>` | ⚠️ Signature identical, but master forwarded the **whole parsed options object** to native (`master:src/index.ts:268`) and iOS really did read a protection key out of it (`master:ios/RNFSManager.m:117-119`), so `NSFileProtectionKey` rode along with the encoding. 4.x passes only `(path, data)`. Because `EncodingOrOptions` also narrowed (section 7), an inline `{ encoding: 'utf8', NSFileProtectionKey: … }` is now a compile error (`TS2353`) rather than a silent drop — but a pre-typed options variable still slips through and loses the key. |
| `appendFile` | `appendFile(filepath, contents: string, encodingOrOptions?): Promise<void>` | `appendFile(filepath, contents: string, encodingOrOptions?): Promise<void>` | ✅ Master did not forward options here either, so nothing is lost. Both create the file if it is missing (`master:ios/RNFSManager.m:139-148`; `ios/Fs2.swift:466-479`). |
| `write` | `write(filepath, contents, position?, encodingOrOptions?): Promise<null>` | `write(filepath, contents, position?, encodingOrOptions?): Promise<void>` | 🔁 Declared return type only. Master declared `Promise<null>` but resolved `undefined`; 4.x declares what it does. `position` still defaults to append: master coerced `undefined` to `-1` in JS, 4.x passes `undefined` and both natives treat a missing/negative position as "seek to end" (`ios/Fs2.swift:590-593`; `Fs2.kt:278` → `RNFSManager.kt:133`). |
| `stat` | `stat(filepath: string): Promise<StatResult>` | `stat(filepath: string): Promise<StatResult>` | ⚠️ Same signature, changed result shape — see `StatResult` in section 7 and the timestamps subsection above. `isFile()`/`isDirectory()` are still methods. `mode` is iOS-only natively and defaults to `0` on Android instead of being absent. **iOS also gained `originalFilepath`**: master's ObjC stat dictionary had no such key (`master:ios/RNFSManager.m:96-102`), so `stat().originalFilepath` was `undefined` on 3.x iOS; 4.x returns the normalized path (`ios/Fs2.swift:286`). |
| `hash` | `hash(filepath: string, algorithm: string): Promise<string>` | `hash(filepath: string, algorithm: HashAlgorithm): Promise<string>` | ⚠️ `algorithm` narrowed from `string` to the `HashAlgorithm` union, so an unsupported name is now a compile error instead of a runtime rejection. All six 3.x algorithms are supported: `sha224` was briefly dropped from the union and both generated enums, and has been restored on this branch (`src/nitro/Fs2.nitro.ts:76-82`, `ios/Fs2.swift:324-326`; Kotlin needed no change - `RNFSManager.kt:184` already mapped it). `HashAlgorithm` is exported from the package root, so you can name the parameter type. |
| `touch` | `touch(filepath, mtime?: Date, ctime?: Date): Promise<void>` | `touch(filepath, mtime?: Date, ctime?: Date): Promise<void>` | 🔁 Public signature unchanged — still takes `Date`. Master gated `ctime` behind a JS-side `Platform.OS === 'ios'` check (`master:src/index.ts:357-358`); 4.x passes both through and lets native decide, and Android still applies only `mtime` (`Fs2.kt:312-315`). Android briefly multiplied the incoming millisecond value by 1000, putting touched files ~30,000 years in the future; fixed on this branch (`RNFSManager.kt:453-455`). |

## 3. System information

| Function | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| `getFSInfo` | `getFSInfo(): Promise<FSInfoResult>` | `getFSInfo(): Promise<FSInfoResult>` | 🔁 iOS returns `{ totalSpace, freeSpace }` on both versions. On **Android**, 3.x also resolved `totalSpaceEx`/`freeSpaceEx` without declaring them in `FSInfoResult` (`master:RNFSManager.java:549-554`) — reachable because `NativeModules` was `any`. 4.x briefly computed and discarded them; they are now declared as optional fields and populated on Android (`Fs2.kt:336-345`), left `undefined` on iOS and when no external volume is mounted. 4.x Android is also more robust: it guards on `MEDIA_MOUNTED` and catches (`RNFSManager.kt:400-410`), where master called `StatFs` on the external path unconditionally and could throw. |
| `getAllExternalFilesDirs` | `getAllExternalFilesDirs(): Promise<string[]>` — Android only, **no iOS implementation at all** | `getAllExternalFilesDirs(): Promise<string[]>` | 💥 **on iOS.** Android is a faithful port of `master:RNFSManager.java:569-578` (it was an unconditional throw for part of 4.x development; that is fixed on this branch). On iOS, master's ObjC exported no such method, so the call threw a synchronous `TypeError: RNFSManager.getAllExternalFilesDirs is not a function`. 4.x iOS resolves `[]` (`ios/Fs2.swift:756-760`). A loud failure became a silent empty success — and note this is **not** the `ENOTSUP:` treatment section 9 describes. |
| `scanFile` | `scanFile(path: string): Promise<string[]>` — Android only, **no iOS implementation at all** | `scanFile(path: string): Promise<string[]>` | 💥 **on iOS**, for the same reason (`ios/Fs2.swift:750-754`). On Android, ported from `master:RNFSManager.java:581-591`, with one real fix: master resolved the single scanned path as a **bare string** despite typing the result `string[]` (`master:RNFSManager.java:590`); 4.x resolves a genuine one-element array. |

## 4. Downloads

| Function | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| `downloadFile` | `downloadFile(options: DownloadFileOptions): DownloadFileResult` | `downloadFile(options: DownloadFileOptions): { jobId: number; promise: Promise<any> }` | 💥 **The promise's resolved value changed — see below.** The call shape and the `{ jobId, promise }` wrapper are the same. The options type changed (section 7). `headers` works. Internally the RN `NativeEventEmitter` events (`DownloadBegin`, `DownloadProgress`, `DownloadResumable`) were replaced by per-jobId Nitro listeners, and the `hasBeginCallback` / `hasProgressCallback` / `hasResumableCallback` bridge flags are gone. |
| `stopDownload` | `stopDownload(jobId: number): void` | `stopDownload(jobId: number): Promise<void>` | 🔁 Now async. Fire-and-forget callers are unaffected; the promise is there if you want to await it. |
| `resumeDownload` | `resumeDownload(jobId: number): void` — iOS only, **no Android implementation at all** | `resumeDownload(jobId: number): Promise<void>` | 💥 **on Android.** Now async on iOS, which is source-compatible. But master's Java exported no `resumeDownload`, so on 3.x Android this threw a synchronous `TypeError`. 4.x Android silently no-ops (`Fs2.kt:430-442`). |
| `isResumable` | `isResumable(jobId: number): Promise<boolean>` — iOS only, **no Android implementation at all** | `isResumable(jobId: number): Promise<boolean>` | 💥 **on Android.** Unchanged on iOS. On 3.x Android it threw a synchronous `TypeError`; 4.x resolves `false` (`Fs2.kt:444-449`). Indistinguishable from a real "this download cannot be resumed". |
| `completeHandlerIOS` | `completeHandlerIOS(jobId: number): void` (iOS) | — | ❌ **Removed, no replacement.** Told iOS you had finished handling a completed background download, so the library could fire the stored system completion handler (`master:ios/RNFSManager.m:591-603`). Deferred by maintainer decision. **Consequence:** `background: true` still creates a background `URLSession` on iOS (`ios/Downloader.swift:62`) that cannot be completed while the app is suspended, so treat background downloads as unsupported in 4.0. |

### 💥 The download promise no longer resolves a result object

In 3.x, `(await downloadFile(opts).promise)` gave you a `DownloadResult`:

```ts
const { statusCode, bytesWritten } = await RNFS.downloadFile(opts).promise  // 3.x
```

Both natives built that object — `master:ios/RNFSManager.m:501-508` and
`master:RNFSManager.java:462-467` — and `master:README.md` documents it as the return
contract.

In 4.x the Nitro method is `Promise<Double>` and resolves **the jobId alone**
(`ios/Fs2.swift:641`; `Fs2.kt:353`, `Fs2.kt:380`). The wrapper returns it untouched
(`src/index.ts:299-305`). Because the promise is typed `Promise<any>` (`src/index.ts:228`),
the destructure above still **compiles and runs**, and both bindings are `undefined`.

Get status and byte count from the new `complete` callback instead:

```ts
const { promise } = RNFS.downloadFile({
  ...opts,
  complete: ({ statusCode, bytesWritten }) => { /* … */ },
})
await promise   // resolves the jobId
```

### Download callbacks

| Callback | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| `begin` | `begin?: (res: DownloadBeginCallbackResult) => void` | `begin?: (event: DownloadEventResult) => void` | ⚠️ Payload type unified — see `DownloadEventResult` in section 7. `statusCode`, `contentLength` and `headers` are now optional, so `res.statusCode` is `number \| undefined`. |
| `progress` | `progress?: (res: DownloadProgressCallbackResult) => void` | `progress?: (event: DownloadEventResult) => void` | ⚠️ Same unification. `contentLength` and `bytesWritten` are now optional. |
| `resumable` | `resumable?: () => void` (iOS) | — | ⚠️ **Renamed to `canBeResumed`.** Passed inline, an unmigrated `resumable: () => {}` is a compile error (`TS2353`); reaching the call inside a pre-typed variable it is dropped and simply never fires. (A vestigial `resumable?: boolean` option briefly existed in the 4.x spec; it was read by nothing on either platform and has been removed.) |
| `canBeResumed` | — | `canBeResumed?: (event: DownloadEventResult) => void` (iOS) | ➕ The replacement for `resumable`. |
| `complete` | — | `complete?: (event: DownloadEventResult) => void` | ➕ New, and now the **only** way to get `statusCode`/`bytesWritten` — see above. |
| `error` | — | `error?: (event: DownloadEventResult) => void` | ➕ New. Master signalled failure only by rejecting the promise. |

### `discretionary` and `cacheable` went from inert to live

Both were declared in master's `DownloadFileOptions` and documented in `master:README.md`,
but master's JS wrapper never copied them into the bridge payload
(`master:src/index.ts:326-341` lists every forwarded key; neither is there). Native therefore
always read nil, and iOS defaulted `cacheable` to `YES`
(`master:ios/RNFSManager.m:479-480`).

4.x forwards both (`src/index.ts:286-287`, deliberately un-coerced so that an explicit
`false` is distinguishable from "not set"). 💥 If you were passing `cacheable: false` or
`discretionary: true` on 3.x iOS, they did nothing; in 4.x they take effect and your download
behaviour will change.

## 5. MediaStore (Android)

The whole namespace moved.

| Item | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| Access | `RNFS.MediaStore.*` — a key on the default export | `import { MediaStore } from 'react-native-fs2'` — a **named export** | ⚠️ `RNFS.MediaStore` is `undefined` in 4.x, so any `RNFS.MediaStore.foo()` throws `TypeError: Cannot read property 'foo' of undefined`. Deliberate (`TASKS.md:177`). |
| `createMediaFile` | `createMediaFile(fileDescriptor: FileDescriptor, mediatype: MediaCollections): Promise<string>` | `createMediaFile(fileDescription: FileDescription, mediatype: MediaCollectionType): Promise<string>` | 🔁 Same shape; types renamed (section 7). Both still default an empty `parentFolder`. |
| `updateMediaFile` | `updateMediaFile(uri, fileDescriptor, mediatype): Promise<string>` | `updateMediaFile(uri, fileDescription, mediatype): Promise<string>` | 🔁 Types renamed only. |
| `writeToMediaFile` | `writeToMediaFile(uri: string, path: string): Promise<void>` | `writeToMediaFile(uri: string, path: string): Promise<void>` | 🔁 Master passed a third `false` argument to native; 4.x's native signature has no such parameter. One JS-visible difference: master's native resolved the **string `"Success"`** (`master:RNFSMediaStoreManager.java:164-168`) despite the JS type declaring `Promise<void>`; 4.x resolves a genuine `undefined`. Only matters if you were reading the resolved value, which the type told you not to. |
| `copyToMediaStore` | `copyToMediaStore(fileDescriptor, mediatype, path): Promise<string>` | `copyToMediaStore(fileDescription, mediatype, path): Promise<string>` | 🔁 Argument order preserved at the JS layer. The underlying Nitro method takes `(sourceFilePath, fileDescription, mediaCollection)` and the wrapper reorders (`src/_mediastore.ts:56-66`); Kotlin reorders back before calling through (`MediaStore.kt:73-86`). |
| `queryMediaStore` | `queryMediaStore(searchOptions): Promise<MediaStoreQueryResult>` | `queryMediaStore(searchOptions): Promise<MediaStoreFile \| undefined>` | ⚠️ Two changes. The result type is richer and renamed (section 7), and **"not found" now resolves `undefined` instead of rejecting** (`MediaStore.kt:88-98`, deliberate per `TASKS.md:175`) — a `try/catch` written against 3.x will not fire. Under `strict` the compiler catches the follow-on: `result.uri` is `TS18048: 'result' is possibly 'undefined'`. Without `strict`, it is a runtime `TypeError`. Search options also became mostly optional except `mediaType`. |
| `deleteFromMediaStore` | `deleteFromMediaStore(uri: string): Promise<boolean>` | `deleteFromMediaStore(uri: string): Promise<boolean>` | ✅ |
| `MEDIA_AUDIO` / `MEDIA_IMAGE` / `MEDIA_VIDEO` / `MEDIA_DOWNLOAD` | `'Audio'` / `'Image'` / `'Video'` / `'Download'` | same values | 🔁 Values identical; only the type name changed (`MediaCollections` → `MediaCollectionType`) and access is via the named export. |
| iOS behaviour | Not implemented | All six methods reject with `ENOTSUP: MediaStore is not supported on iOS` (`ios/MediaStore.swift:5-27`) | 🔁 Deliberate no-op stubs (`TASKS.md:176`), now carrying the `CODE:` prefix the error contract requires. |

## 6. Path constants

All ten are present on the default export in both versions, with the same names. What
changed is the **value you get on the platform where the constant does not apply** — and that
was never uniform on master.

**Master, iOS** (`master:ios/RNFSManager.m:682-696`) exported only seven of the ten. Three
were absent from the constants map entirely and read back as `undefined`.

| Constant | master iOS | master Android | 4.x iOS | 4.x Android |
|---|---|---|---|---|
| `MainBundlePath` | bundle path | **`undefined`** | bundle path | `''` |
| `CachesDirectoryPath` | path | path | path | path |
| `DocumentDirectoryPath` | path | path | path | path |
| `TemporaryDirectoryPath` | path | path | path | path |
| `LibraryDirectoryPath` | path | **`undefined`** | path | `''` |
| `ExternalCachesDirectoryPath` | **`undefined`** | path or **`null`** | `''` | path or `''` |
| `DownloadDirectoryPath` | **`undefined`** | path | `''` | path |
| `ExternalDirectoryPath` | **`null`** (`NSNull`) | path or **`null`** | `''` | path or `''` |
| `ExternalStorageDirectoryPath` | **`null`** (`NSNull`) | path or **`null`** | `''` | path or `''` |
| `PicturesDirectoryPath` | **`undefined`** | path | ⚠️ **a real path** | path |

Android's `null`s come from the explicit else-branches at `master:RNFSManager.java:642-661`;
4.x replaces them with `''` via `?: ""` (`Fs2.kt:40-54`).

Three things to take from that table:

- **Type.** Master typed each as `String` — the boxed object type, not `string` — so
  `const p: string = RNFS.DocumentDirectoryPath` was a type error needing a cast. 4.x types
  them as `string`. Strictly an improvement; it can only turn errors into non-errors.
- **Unavailable constants are now `''`.** `''` is falsy, so `if (RNFS.ExternalStorageDirectoryPath)`
  behaves the same, but `=== null` and `=== undefined` no longer match. ⚠️ Grep for those.
- 💥 **`PicturesDirectoryPath` on iOS is the exception, and it goes the wrong way.** It was
  `undefined` on 3.x iOS; 4.x returns `FileManager.default.urls(for: .picturesDirectory, …)`
  (`ios/Fs2.swift:42`), a **non-empty** path to a sandbox location that does not exist. Every
  falsy-guard that used to skip this constant on iOS now passes, and the path fails later at
  the filesystem call instead of at the guard.

## 7. Types

**Read this first:** `master:src/index.ts` contains exactly one export statement —
`export default` at line 161 — and master's `package.json` points `types` at
`lib/typescript/index.d.ts`, built from that file. **No 3.x type was importable from
`'react-native-fs2'`.** Every "the alias is gone" row below is therefore a change in what
*could* be exported, not a break in working code: `import type { Headers } from 'react-native-fs2'`
failed on 3.x too. The master column describes `master:src/types.ts`, which was
package-internal.

All 4.x types named in this document are now exported from the package root, including
`HashAlgorithm`, `FileProtectionType` and `NativeStatResult` — the first two appear in public
signatures (`hash()`'s parameter and `MkdirOptions.fileProtection`) and were unnameable by
consumers until this branch (`src/index.ts:21-29`).

| Type | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| `ReadDirItem` | `{ ctime: Date \| undefined; mtime: Date \| undefined; name; path; size; isFile(): boolean; isDirectory(): boolean }` | `{ name; path; size; mtime: number; ctime?: number; isFile(): boolean; isDirectory(): boolean }` | ⚠️ `ctime`/`mtime` are numbers in **milliseconds** — see the timestamps subsection in section 1. `.getTime()` on them is a compile error, so 3.x call sites are caught. Master's declared type said `Date \| undefined` while the code resolved `null` (`master:src/index.ts:209-210`), so the type was wrong there too. In 4.x `mtime` is required; `ctime` is omitted rather than nulled, and on Android `readDir` never populates it at all (`Fs2.kt:138` passes `null`) while `stat` reuses `mtime`. **`isFile()`/`isDirectory()` remain methods** — a maintainer decision, so `items[0].isFile()` keeps working. |
| `StatResult` | `{ type: any; name: string \| undefined; path; size; mode; ctime: number; mtime: number; originalFilepath; isFile(); isDirectory() }` | `{ type?: any; name?: string; path; size; mode: number; ctime: number; mtime: number; originalFilepath; isFile(); isDirectory() }` | ⚠️ for the timestamp type; otherwise 4.x is the more honest declaration. Master's type said `ctime`/`mtime` were `number` while `stat()` actually resolved `Date` objects — it went unnoticed because `NativeModules.RNFSManager` is `any`, so nothing type-checked the mapping. 4.x really does return numbers, in milliseconds. `type` and `name` are marked optional because **neither is populated** by `stat()` — equally true on master, where the type simply claimed otherwise. `mode` is iOS-only natively and is `0` on Android rather than absent. The native `type` is now the `'file' \| 'directory'` union `StatResultType` instead of the numeric `RNFSFileTypeRegular`/`RNFSFileTypeDirectory` constants (which are gone). |
| `MkdirOptions` | `{ NSURLIsExcludedFromBackupKey?: boolean; NSFileProtectionKey?: string }` | `{ excludedFromBackup?: boolean; fileProtection?: FileProtectionType }` | ⚠️ Both keys renamed. Compile error on an object literal; silently ignored via a widened variable. |
| `FileProtectionType` | — (was a loose `string`) | `'NSFileProtectionNone' \| 'NSFileProtectionComplete' \| 'NSFileProtectionCompleteUnlessOpen' \| 'NSFileProtectionCompleteUntilFirstUserAuthentication'` | ➕ New union replacing the free-form string. Exported. |
| `FileOptions` | `{ NSFileProtectionKey?: string }` | — | ❌ Removed with the `moveFile`/`copyFile` options parameter. |
| `HashAlgorithm` | — (`algorithm: string`) | `'md5' \| 'sha1' \| 'sha224' \| 'sha256' \| 'sha384' \| 'sha512'` | ⚠️ New union covering exactly the six algorithms master implemented. Exported. |
| `DownloadFileOptions` | `{ fromUrl; toFile; headers?; background?; discretionary?; cacheable?; progressInterval?; progressDivider?; begin?; progress?; resumable?; connectionTimeout?; readTimeout?; backgroundTimeout? }` | Same minus `resumable`, plus `complete?`, `error?`, `canBeResumed?` | ⚠️ `resumable` callback gone (section 4). `headers` still carries over. `discretionary` and `cacheable` carry over *as declarations* but change behaviour — they were dead on master and are live in 4.x (section 4). `jobId` is deliberately **not** part of this type — the library allocates it and returns it. |
| `Headers` / `Fields` | `{ [name: string]: string }` | — (inlined as `Record<string, string>`) | 🔁 The alias names are gone from the source, but they were never reachable from the package root anyway (see the preamble). The shape is unchanged, so `Record<string, string>` is a drop-in. `Fields` was dead on master too — declared, referenced by no API. |
| `DownloadBeginCallbackResult` | `{ jobId; statusCode; contentLength; headers }` | — | 🔁 Replaced by `DownloadEventResult`. |
| `DownloadProgressCallbackResult` | `{ jobId; contentLength; bytesWritten }` | — | 🔁 Replaced by `DownloadEventResult`. |
| `DownloadResult` | `{ jobId; statusCode; bytesWritten }` | — | 💥 Not merely renamed — **nothing resolves this shape any more.** The download promise now resolves a bare jobId number; the fields moved to the `complete` callback's `DownloadEventResult`. See section 4. |
| `DownloadFileResult` | `{ jobId: number; promise: Promise<DownloadResult> }` | — (return type is inlined) | 💥 The returned object still has `jobId` and `promise`, but the promise is typed `Promise<any>` and resolves a number. The `any` is what makes the change silent. |
| `DownloadEventResult` | — | `{ jobId: number; headers?: AnyMap; contentLength?: number; statusCode?: number; bytesWritten?: number; error?: string }` | ➕ One payload for all five download callbacks. Everything except `jobId` is optional, so fields that were required in the 3.x per-callback types now need narrowing. `headers` is Nitro's opaque `AnyMap`, not `Record<string, string>`. |
| `FileDescriptor` | `{ name; parentFolder; mimeType }` | — | 🔁 Renamed to `FileDescription`; same fields. |
| `FileDescription` | — | `{ name; mimeType; parentFolder }` | ➕ The rename target, and unlike the master original it **is** exported. |
| `MediaCollections` | `'Audio' \| 'Image' \| 'Video' \| 'Download'` | — | 🔁 Renamed to `MediaCollectionType`; same values. |
| `MediaCollectionType` | — | `'Audio' \| 'Video' \| 'Image' \| 'Download'` | ➕ The rename target; exported. |
| `MediaStoreQueryResult` | `{ contentUri: string }` | — | ⚠️ Renamed to `MediaStoreFile`, and `contentUri` renamed to `uri`. |
| `MediaStoreFile` | — | `{ uri; name; mimeType; size; dateAdded?; dateModified?; relativePath? }` | ➕ Replaces `MediaStoreQueryResult` with far more metadata. `dateAdded`/`dateModified` are documented as **milliseconds** (`src/nitro/MediaStore.nitro.ts:16-17`), unlike `stat`/`readDir`. |
| `MediaStoreSearchOptions` | `{ uri; fileName; relativePath; mediaType }` — all required | `{ uri?; fileName?; relativePath?; mediaType }` | 🔁 All but `mediaType` are optional now. Purely a relaxation. |
| `Encoding` | `'utf8' \| 'base64' \| 'ascii' \| 'arraybuffer'` | `'utf8' \| 'ascii' \| 'base64' \| 'arraybuffer'` | ✅ Same members. Exported from the root in 4.x (via `_filestream.ts:56`); was not on master. |
| `EncodingOrOptions` | `Encoding \| Record<string, any>` | `Encoding \| { encoding?: Encoding }` | ⚠️ Narrowed. Master accepted arbitrary extra keys — which is how `FileOptions` rode along with `writeFile` — so 4.x rejecting them is what turns that drop into a compile error rather than a silent one. |
| `ProcessedOptions` | `Record<string, any \| Encoding>` | — | 🔁 Internal type on both sides. |
| `StatResultType` | — | `'file' \| 'directory'` | ➕ Replaces the numeric `RNFSFileTypeRegular` / `RNFSFileTypeDirectory` native constants. Exported. |
| `NativeStatResult` | — | `{ mode?; ctime; mtime; size; type; originalFilepath }` | ➕ The raw native struct, exported for advanced use. `StatResult` is what `stat()` returns, and is what you want unless you are wrapping the Nitro object directly. |

## 8. File Streaming API — all new in 4.x ➕

None of this exists on master. Every export is marked `@beta` and may change without a major
version bump. All 17 functions reach the package root through `export * from './_filestream'`
(`src/index.ts:333`).

| Export | Signature | Notes |
|---|---|---|
| `createReadStream` | `(path: string, options?: ReadStreamOptions) => Promise<ExtendedReadStreamHandle>` | Handle exposes `start()`, `pause()`, `resume()`, `close()`, `isActive()`. |
| `createWriteStream` | `(path: string, options?: WriteStreamOptions) => Promise<ExtendedWriteStreamHandle>` | Handle exposes `write()`, `flush()`, `close()`, `isActive()`, `getPosition()`, `end()`. |
| `listenToReadStreamData` | `(streamId, cb: (e: ReadStreamDataEvent) => void) => () => void` | **Single-subscriber**: the native map holds one callback per (stream, event), so a second registration evicts the first and either unsubscribe removes whichever is current. Do not subscribe to a stream `copyFileWithProgress` or `processFileInChunks` is already driving. |
| `listenToReadStreamProgress` | `(streamId, cb: (e: ReadStreamProgressEvent) => void) => () => void` | Same constraint. |
| `listenToReadStreamEnd` | `(streamId, cb: (e: ReadStreamEndEvent) => void) => () => void` | Same constraint. |
| `listenToReadStreamError` | `(streamId, cb: (e: ReadStreamErrorEvent) => void) => () => void` | Same constraint. |
| `listenToWriteStreamProgress` | `(streamId, cb: (e: WriteStreamProgressEvent) => void) => () => void` | Same constraint. |
| `listenToWriteStreamFinish` | `(streamId, cb: (e: WriteStreamFinishEvent) => void) => () => void` | Same constraint. |
| `listenToWriteStreamError` | `(streamId, cb: (e: WriteStreamErrorEvent) => void) => () => void` | Same constraint. |
| `readStream` | `(filePath, encoding?: Encoding, options?: { bufferSize?: number }) => Promise<string \| ArrayBuffer>` | Reads a whole file. **`encoding` defaults to `'arraybuffer'`**, not `'utf8'`. Chunks are joined once and decoded once over the assembled buffer, so multi-byte characters spanning a chunk boundary survive. Default buffer 64 KB. |
| `writeStream` | `(filePath, data: string \| ArrayBuffer, encoding?: Encoding) => Promise<void>` | Writes a whole file. `encoding` also defaults to `'arraybuffer'`. |
| `copyFileWithProgress` | `(sourcePath, destPath, options?: { bufferSize?; onProgress?; highWaterMark? }) => Promise<void>` | Writes are serialised (one in flight) and the reader is paused past `highWaterMark` (default 8) queued chunks, resuming at half that. Both streams close on every exit path. |
| `processFileInChunks` | `(filePath, chunkProcessor: (chunk: ArrayBuffer, chunkIndex: number, position: number) => Promise<void> \| void, options?: ReadStreamOptions) => Promise<void>` | Processor is awaited before the next chunk, so chunks arrive in order. `chunkIndex`/`position` are `number`, matching the rest of the surface. |
| `arrayBufferToString` | `(buffer: ArrayBuffer, encoding?: Encoding) => string` | Utility. |
| `stringToArrayBuffer` | `(str: string, encoding?: Encoding) => ArrayBuffer` | Utility. |
| `concatenateArrayBuffers` | `(a: ArrayBuffer, b: ArrayBuffer) => ArrayBuffer` | Utility. Calling it in a loop is quadratic — prefer `concatenateChunks`. |
| `concatenateChunks` | `(chunks: ArrayBuffer[]) => ArrayBuffer` | Joins in one allocation and one pass. |

Stream types, all new and all exported: `ReadStreamOptions`, `WriteStreamOptions`,
`ReadStreamDataEvent`, `ReadStreamProgressEvent`, `ReadStreamEndEvent`,
`ReadStreamErrorEvent`, `WriteStreamProgressEvent`, `WriteStreamFinishEvent`,
`WriteStreamErrorEvent`, `ExtendedReadStreamHandle`, `ExtendedWriteStreamHandle`. Numeric
event fields are `number` in the public types even though the Nitro layer carries them as
`Int64`. The bare Nitro `ReadStreamHandle` / `WriteStreamHandle` are not re-exported; the
`Extended*` interfaces extend them and are what `createReadStream`/`createWriteStream`
return.

## 9. Cross-cutting changes

| Area | master (3.x) | nitro (4.x) | What changed |
|---|---|---|---|
| Native architecture | RN bridge (`NativeModules`, `NativeEventEmitter`) | Nitro Modules over JSI | 🔁 No bridge serialisation; binary data crosses as `ArrayBuffer` rather than base64 strings. |
| Peer dependencies | `react`, `react-native` | `react`, `react-native >=0.82.0`, `react-native-nitro-modules ^0.37.0` | ⚠️ New required peer dependency, and a higher RN floor. |
| Runtime dependencies | `base-64`, `utf8` | `buffer` | 🔁 Encoding is done with `Buffer` now instead of the two shims. |
| Optional dependency | `react-native-blob-jsi-helper` needed for `readFile(path, 'arraybuffer')` | none | 🔁 Removed — the buffer comes straight from native. |
| Error messages | `CODE: message` from native | `CODE: message`, preserved through Nitro on both platforms | 🔁 Nitro mangles thrown errors differently per platform. 4.x adds `JsVisibleError` on Android (`android/.../utils/JsVisibleError.kt`) and `CustomStringConvertible` on the iOS stream errors (`ios/StreamError.swift:3`) so `err.message.startsWith('ENOENT')` still works. Same contract, different machinery. |
| Unsupported operations | Mixed / unprefixed | `ENOTSUP: …` | 🔁 iOS MediaStore stubs and the Android API-level guards carry the code prefix. ⚠️ **Not universal** — iOS `scanFile` and `getAllExternalFilesDirs` resolve `[]` instead of rejecting `ENOTSUP` (section 3). |
| `RNFSFileTypeRegular` / `RNFSFileTypeDirectory` | Native constants, read off the module | — | 🔁 Gone. Never documented as public API, but reachable via `NativeModules.RNFSManager` and used by master's own `stat`/`readDir` mapping. Use `stat().isFile()` / the `StatResultType` union instead. |
| `RNFSFileProtection*` constants | Four native constants on iOS (`master:ios/RNFSManager.m:692-695`) | — | 🔁 Gone. Also undocumented but reachable via `NativeModules.RNFSManager`. Their four values are exactly the `FileProtectionType` union, which is exported (section 7). |

---

## 10. Upgrade checklist

### Fails silently — no compile error, no throw, wrong behaviour

These are the 💥 rows. Nothing will tell you; you have to go looking.

```bash
# Download promise resolves the jobId now, not { statusCode, bytesWritten }.
grep -rn "downloadFile" --include=*.ts --include=*.tsx --include=*.js src/

# cacheable/discretionary were inert on 3.x and are live now.
grep -rn "cacheable\|discretionary" src/

# iOS: PicturesDirectoryPath is now a truthy path to a nonexistent directory.
grep -rn "PicturesDirectoryPath" src/

# iOS: copyFile/moveFile overwrite an existing destination instead of failing.
grep -rn "copyFile\|moveFile" src/

# Android: getFSInfo no longer returns totalSpaceEx/freeSpaceEx.
grep -rn "SpaceEx" src/

# Android: isResumable resolves false, resumeDownload no-ops (both threw on 3.x).
# iOS: scanFile / getAllExternalFilesDirs resolve [] (both threw on 3.x).
grep -rn "isResumable\|resumeDownload\|scanFile\|getAllExternalFilesDirs" src/

# iOS: unlink on a missing path no longer rejects.
# Android: unlink/exists now resolve content:// URIs to the underlying file.
grep -rn "unlink\|exists" src/
```

### Caught by the compiler

Object-literal call sites fail to build. The same keys reaching a call inside a widened
variable do **not** — check those by hand.

```bash
grep -rn "NSFileProtectionKey\|NSURLIsExcludedFromBackupKey" src/   # renamed; also dropped from writeFile
grep -rn "resumable:"                                              # download callback, now canBeResumed
grep -rn "queryMediaStore"                                         # resolves undefined; needs a null check under strict
grep -rn "moveFile(.*,.*,\|copyFile(.*,.*,"                        # third options argument removed
```

### Caught on first run

```bash
grep -rn "RNFS.MediaStore"        # named export now: import { MediaStore } from 'react-native-fs2'
grep -rn "completeHandlerIOS"     # removed, no replacement
```

### Open defects in 4.x, not migration differences

- **iOS background downloads are unusable** without `completeHandlerIOS`. See section 4.
