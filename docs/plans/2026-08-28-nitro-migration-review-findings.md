# Review pass — `nitro-migration` → `master` (4.0.0)

Worked against `docs/plans/2026-08-28-nitro-migration-review-handoff.md`, §1–§5, in order.
Tree state at time of review: the API-audit tranche is still uncommitted (10 modified files +
`JsVisibleError.kt`), exactly as §8 predicted.

**Sources.** In addition to the branch, this pass reads the migration planning docs one level
above the repo — `../MIGRATION_CHECKLIST.md`, `../TASKS.md`, `../PLAN.md`,
`../ios_native_analysis.md`, `../android_native_analysis.md`. Several items below are graded
against them, because they record which divergences from `master` were **deliberate**.

**Caveat on those docs:** they lag the branch. `getFSInfo` is `[ ] To Do`
(`MIGRATION_CHECKLIST.md:35`) but implemented; the entire MediaStore sub-phase is unchecked
(`TASKS.md:171-176`) but shipped; native stream implementation is `[/] PENDING`
(`MIGRATION_CHECKLIST.md:54`) but present on both platforms. So they are good evidence of
**intent**, and no evidence at all of current state.

**Every finding below was then re-verified against the code**, including against
`nitrogen/generated/**` as ground truth for the native ABI. Where a doc and the code disagree,
the code is what is reported. Verification notes are inline.

---

## Verdict

The migration is sound and §3a — the item the handoff ranked highest — is clean.

Of the defects below, the ones that actually decide the release are **B3** (a working `master`
API that now throws), **B4/B5/B6** (small, local, unambiguous bugs), **B9** (an iOS-only data
race), and the state of `PR_DESCRIPTION.md`, which is wrong on enough points to mislead every
upgrading consumer. **B1, B2 and C4 turned out to be deliberate or known-incomplete** once the
planning docs are taken into account — they are documentation debt, not surprises.

---

## Blocking correctness defects

### B1. Download request headers are dropped in the JS bridge
`src/index.ts:283` — **known-incomplete area, per `MIGRATION_CHECKLIST.md:40`**

The Nitro spec declares `downloadFile(options, headers?)` (`src/nitro/Fs2.nitro.ts:114-117`) and
**both platforms implement it** — `ios/Downloader.swift:33,74-75` sets
`config.httpAdditionalHeaders`, `android/.../Fs2.kt:351,362` converts and attaches them. The JS
wrapper calls `RNFS2Nitro.downloadFile(nitroOptions)` with one argument. The second is never
passed, and `headers` was removed from the branch's `DownloadFileOptions`
(`src/nitro/Fs2.nitro.ts:46-59`; master had it at `src/types.ts:39`), so a consumer who writes
`headers: {...}` gets a TypeScript excess-property error *and* no headers at runtime.

**Verified.** The generated ABI requires two arguments on all three platforms —
`HybridFs2Spec.hpp:100`, `HybridFs2Spec.kt:130`, `HybridFs2Spec.swift:39` all take
`(options, headers)`. `headers` is optional, so the one-argument call at `src/index.ts:283` is
legal at the JSI layer and fails silently rather than throwing.

**Grading:** `downloadFile` is marked `[/]` — *In Progress / Partially Done*, "eventing TBD" — in
`MIGRATION_CHECKLIST.md:40`, as are `stopDownload` and `resumeDownload` (`:41-42`). So this sits
inside work the team already knows is unfinished, and I withdraw the suggestion that it went
unnoticed.

What remains a genuine finding is the mismatch with the consumer-facing claim:
`PR_DESCRIPTION.md:69-70` calls the download API "100% backward compatible" and `:82` says "the
public API is unchanged", for a subsystem the internal checklist marks as partially done. One of
the two documents has to change.

### B2. `readDir()` — `isFile`/`isDirectory` are booleans, not methods
`src/nitro/Fs2.nitro.ts:7-8`, passthrough at `src/index.ts:112-114` — **deliberate design**

Master mapped native results into `isFile: () => boolean` (`git show master:src/index.ts:206-219`).
The branch returns the raw Nitro struct, where they are plain booleans, so `items[0].isFile()`
throws `TypeError: isFile is not a function`.

**Verified in native.** `Fs2.kt:133-135` constructs `ReadDirItem(isFile = (stat.type == …),
isDirectory = (…))` as Kotlin `Boolean`s; iOS builds the same struct (`Fs2.swift:206-231`).
`src/index.ts:112-114` returns the array untouched. So the booleans reach JS.

**Grading:** this is the designed shape, not a slip — `TASKS.md:87` specifies
`DirItem` as `{ name, path, size, isDirectory: boolean, isFile: boolean, mtime? }`. I withdraw
the characterisation of it as an oversight.

Two things still stand, and the second changed on re-check:

- It is a **breaking change to the most-used call in the library, absent from the migration
  guide.** `PR_DESCRIPTION.md:88-94` documents the timestamp change *on this very type* and says
  nothing about the accessors; `:190` tells people to test only `mtime`/`ctime`.
- **`stat()` is the one that deviates from plan, not `readDir`.** `TASKS.md:95` (Task 4.8.1)
  specifies `StatResult` with `isDirectory: boolean, isFile: boolean` — booleans for *both* APIs.
  `readDir` matches that; `stat` does not, because `src/types.ts:23-24` declares
  `isFile: () => boolean` and `src/index.ts:125-126` maps to functions. So the two sibling APIs
  now disagree, and it is `stat` that drifted. Whichever way it is settled, it should be settled
  deliberately — `stat` keeping the master-compatible form is arguably the better outcome, which
  would make `readDir` the one to revisit.

### B3. `scanFile` regressed to an unconditional throw on Android
`android/.../Fs2.kt:495-497` — **no planning-doc coverage; unintended**

```kotlin
override fun scanFile(path: String): Promise<Array<String>> {
    return Promise.async { throw FsError("scanFile is not supported") }
}
```

Master implements it via `MediaScannerConnection.scanFile`
(`master:android/src/main/java/com/rnfs2/RNFSManager.java:581`), and
`../android_native_analysis.md:79` catalogues it as existing functionality to port. The spec
still advertises it as "Android only (Triggers Media Scanner)" (`src/nitro/Fs2.nitro.ts:155`).

It appears in **no** row of `MIGRATION_CHECKLIST.md` and **no** task in `TASKS.md` — it was
neither ported nor marked `[N/A]`. A working API on `master` throws on every call in 4.0.0.

**Verified exhaustively.** Every `scanFile` occurrence in the branch: the spec
(`src/nitro/Fs2.nitro.ts:155`), the JS passthrough (`src/index.ts:207-208`), the generated
bindings, the iOS no-op returning `[]` (`Fs2.swift:748-752`, correct — it is Android-only), and
the Android throw. `RNFSManager.kt` — the Kotlin helper every other Android method delegates to,
converted from the Java that implemented this — **has no `scanFile` at all**. It was not ported
during the Java→Kotlin conversion, and the throw is standing in for the missing helper.

### B4. `chunk` leaks to JS as a `bigint` — `'chunks'` typo
`src/utils.ts:158-167`

`mapPropsWithBigInt` lists `'chunks'`. The field on `ReadStreamDataEvent` is `chunk`
(`src/nitro/Fs2Stream.nitro.ts:27`, `chunk: Int64`). No other event has a `chunks` field, so the
entry is dead and `chunk` is never converted.

`convertFs2StreamEventResultsToPlain` therefore hands `listenToReadStreamData` subscribers a
`bigint` where `src/types.ts:43` promises `number`. `event.chunk + 1` throws
`TypeError: Cannot mix BigInt and other types`. `PR_DESCRIPTION.md:129` only interpolates it into
a template literal, which is the one operation that hides the bug.

**Verified by exhaustion.** The stream spec declares nine `Int64` fields
(`Fs2Stream.nitro.ts:5,6,27,28,33,34,40,52,53,58`). Cross-referencing every one against
`mapPropsWithBigInt`: `start`, `end`, `position`, `bytesRead`, `totalBytes`, `bytesWritten`,
`lastChunkSize` are all present. `chunk` is the sole omission, and the list's `'chunks'` matches
no field on any event type. One-character fix.

### B5. Android `downloadFile` throws synchronously instead of rejecting
`android/.../Fs2.kt:403`

```kotlin
downloadPromise.reject(reject(options.toFile, e)) // Also rethrow for the promise rejection
```

`reject()` (`Fs2.kt:500-514`) never returns — every branch is a `throw`. So the argument
expression throws before `downloadPromise.reject(...)` is ever invoked, and the exception escapes
`downloadFile` synchronously (the body is plain code, not a coroutine). `downloadPromise` is
never settled and never returned.

Result: a setup failure (malformed URL, unwritable destination) makes the **JS call itself throw**
rather than rejecting `result.promise`. `compat.downloadFile` (`src/index.ts:283`) calls it inside
the returned object literal, so the throw propagates out of `RNFS.downloadFile(...)`. On master
this was a promise rejection. The trailing comment shows the intent was the opposite of the
behaviour.

**Verified.** All four branches of `reject()` (`Fs2.kt:503,506,510,513`) are `throw` statements;
there is no `return` anywhere in the function body. The `: Throwable` return type is never
satisfied by any path.

### B6. MediaStore "not found" rejects with a bare `java.lang.Error`
`android/.../MediaStore.kt:91-92`

```kotlin
println("File not found: ${searchOptions.fileName}")
queryPromise.reject(Error("File not found: ${searchOptions.fileName}"))
```

This is precisely the §3b failure mode, still live. It bypasses `JsVisibleError` entirely, so
fbjni's `printStackTrace` path mangles it into `java.lang.Error: File not found: x\n\tat ...` —
the exact breakage `JsVisibleError.kt` was written to prevent. It also carries no `CODE:` prefix,
so it violates the error contract regardless of the mangling.

Separately, this is a **contract mismatch**: the spec types the result
`Promise<MediaStoreFile | undefined>` (`src/nitro/MediaStore.nitro.ts:54`,
`src/_mediastore.ts:70`). "Not found" should resolve `undefined`, not reject. And the `println`
is stray debug output.

### B7. `copyFileWithProgress` has no back-pressure and no write ordering
`src/_filestream.ts:390-400`

```ts
unsubscribeData = listenToReadStreamData(readStream.streamId, async (event) => {
  try { await writeStream.write(event.data) } catch (error) { cleanup(); reject(error) }
})
```

The native read loop does not await this callback — it returns `void` to native immediately and
the next chunk is emitted regardless. So:

- **Unbounded queueing.** Nothing calls `readStream.pause()`. On a multi-GB file the reader
  outruns the writer and every pending chunk stays resident. This is the exact API
  `PR_DESCRIPTION.md:39` advertises as "process multi-GB files without memory issues".
- **No ordering guarantee.** Each `write()` is an independent async native call issued before the
  previous resolves. Ordering then depends entirely on the native queue discipline rather than on
  anything this code establishes — a silent file-corruption risk on the destination.
- **Leak.** `writeStream.close()` is called on completion; `readStream` never is. The native
  entry in `readStreams` is orphaned.

**Verified in the native loop.** `Fs2Stream.swift:238` invokes the data listener as a plain
synchronous call inside `while state.isActive`, then immediately advances `position` and reads
the next chunk (`:243`). Nothing in the loop can observe, let alone await, the `Promise` the JS
callback returns. The only throttle that exists is `state.isPaused` (`:199-203`), which
`copyFileWithProgress` never sets.

Answering §2's back-pressure question directly: no, there is nothing preventing it.

### B8. `readStream()` corrupts multi-byte text and is O(n²)
`src/_filestream.ts:285-302`

Two defects in one function:

- `bufferSize: 128` is hardcoded. A 10 MB file emits ~78,000 JSI callbacks; each one runs
  `concatenateArrayBuffers`, which allocates a new buffer of the full accumulated length and
  copies everything again — quadratic, roughly 390 GB of memcpy for that 10 MB file.
- With a text encoding, each 128-byte chunk is decoded **independently**
  (`decodeContents(event.data, encoding)` at line 296). A UTF-8 sequence straddling a chunk
  boundary is decoded as two invalid fragments. Any non-ASCII file read via
  `readStream(path, 'utf8')` comes back with replacement characters.

The second is a correctness bug, not a performance note.

### B9. iOS stream registries are unsynchronised
`ios/Fs2Stream.swift:43-44,52-58`

```swift
private var readStreams: [String: ReadStreamState] = [:]
private var writeStreams: [String: WriteStreamState] = [:]
// + 7 listener dictionaries, all plain Swift Dictionary
```

These are mutated and read from inside `Promise.async` closures running on background executors —
`readStreams[streamId] = state` at :73, `removeValue` at :279 and :329, reads at :171, :292, :308,
:352, :367. Concurrent access to a Swift `Dictionary` is undefined behaviour; concurrent mutation
can corrupt the hash table or crash.

Android got this right: `ConcurrentHashMap` throughout (`Fs2Stream.kt:46-64`). This is a platform
asymmetry, and iOS is the unprotected one. §3c asked the question; the answer is that the
registries are not protected on iOS.

**Verified — the race is concrete, not theoretical.** The read loop is
`Task(priority: .background)` (`Fs2Stream.swift:195`), and it reads
`self.readStreamDataListeners[streamId]` at :238 and the other six maps at :122, :140, :153,
:250, :262, :268. Meanwhile `listenToReadStreamData` and its siblings **write** those same
dictionaries at :447-477 from the JS thread, since `listenTo*` is a synchronous Nitro method.
Background reads concurrent with JS-thread writes, on an unsynchronised Swift `Dictionary`.

The strongest evidence that this is an oversight rather than a considered choice: `BufferPool`,
declared six lines below the registries and used from the same background task, **does** guard its
state with an `NSLock` (`ios/BufferPool.swift:14`). The locking discipline is present in the file
and simply was not applied to the maps.

*Context:* `MIGRATION_CHECKLIST.md:54` marks native stream implementation `[/] PENDING`. That row
is stale — both platforms are implemented — but it does suggest the native stream layer never got
a completion pass, which is consistent with B7–B9 clustering here.

---

## API contract and migration guide

`PR_DESCRIPTION.md` is the deliverable a consumer upgrades against. Audited against the real diff
per §1d, and against the planning docs:

| # | Issue | Grading |
|---|---|---|
| C1 | `completeHandlerIOS` and `MainBundlePath` removed, undisclosed — **§1a confirmed**. Absent from `src/`, `ios/`, `android/`, `nitrogen/`; still documented in `README.md:130` (with signature) and `README.md:531`. | **Unintended.** The doc set has an explicit convention for deliberate removals — `MIGRATION_CHECKLIST.md:43-44` gives `pathForBundle`/`pathForGroup` `[N/A]` rows reading "Not needed in Nitro module". Neither of these got one. `MainBundlePath` is worse: `../ios_native_analysis.md:80` lists `RNFSMainBundlePath` among the constants to port, and `TASKS.md:185` (Task 4.20.4) requires constants to "match the original library's behavior". |
| C2 | MediaStore moved off the default export and **is not in the migration guide at all** — contradicting §1b's assumption. `PR_DESCRIPTION.md:107` presents `await RNFS.MediaStore.queryMediaStore({...})` as the *corrected* v4 usage; `compat` has no `MediaStore` key, so that line throws. | Move is deliberate (`TASKS.md:175`, Task 4.18.5). The guide being wrong about it is not. |
| C3 | Wrong dependency versions. Guide says `react-native-nitro-modules@^0.29.7` (lines 52, 162, 208) and "React Native: >=0.80" (207). Actual: `^0.37.0` and `>=0.82.0` (`package.json:108-112`). Following `PR_DESCRIPTION.md:162` installs an incompatible Nitro. | Stale doc; predates the 0.37 upgrade commits. |
| C4 | `moveFile`/`copyFile` lost their `options: FileOptions` parameter (`NSFileProtectionKey`, iOS). Re-verified in native: `Fs2.swift:340,392`, `Fs2.kt:66,78` and `HybridFs2Spec.hpp:86-87` all take `(filepath, destPath)` only — code and doc agree. | **Deliberate** — `MIGRATION_CHECKLIST.md:18-19` says "Options initially omitted" on both rows. I withdraw this as an undisclosed removal; it needs to reach the consumer-facing guide, and "initially" implies an intent to restore that should be confirmed or dropped. |
| C5 | `MkdirOptions` keys renamed: `NSURLIsExcludedFromBackupKey`→`excludedFromBackup`, `NSFileProtectionKey`→`fileProtection`; silently ignored at runtime. | Rename is deliberate (`TASKS.md:63` names `fileProtection`). Undocumented for consumers. |
| C6 | `downloadFile`'s `resumable` callback became `canBeResumed`, and `resumable` is now an unrelated boolean option that `nitroOptions` never forwards (`src/index.ts:259,269-279`). Existing `resumable: () => {}` code silently never fires. | Inside the `[/]` download work per C1's reasoning; still undocumented. |
| C7 | `queryMediaStore` return type gained `| undefined` (`src/_mediastore.ts:70`). | Undocumented. |

`PR_DESCRIPTION.md:45` ("Mostly Backward Compatible!"), `:56` ("API Improvements (Non-Breaking)")
and `:225` ("only minor type changes for timestamps") are inaccurate given B2, B3 and C1–C7 —
regardless of which of those were deliberate. Deliberate breaking changes are still breaking
changes, and this is the document that has to carry them.

---

## Streaming API (§2)

Beyond B4, B7 and B8:

- **Single-subscriber registries.** `listenTo*` stores one callback per `(streamId, event)` —
  `ios/Fs2Stream.swift:447`, `android/.../Fs2Stream.kt:528`, both `map[streamId] = cb`. A second
  subscription to the same stream silently evicts the first, and either returned unsubscribe
  removes whichever is currently installed. The `() => void` return signature implies
  multi-subscriber semantics that do not exist. This bites anyone who calls
  `listenToReadStreamData` on a stream `copyFileWithProgress` is already driving.
  Note `MIGRATION_CHECKLIST.md:52` claims listeners are "**COMPLETED:** All event listeners
  implemented with proper cleanup".
- **Leaked error listeners.** `readStream` (`_filestream.ts:305-309`), `writeStream` (`:336-339`)
  and `processFileInChunks` (`:472-476`) unsubscribe data/end on the success path but never
  `unsubscribeError`. Given the single-slot registry above, that orphaned entry also blocks the
  next subscriber for that stream id.
- **Streams are never closed on the happy path.** `readStream` and `processFileInChunks` resolve
  without calling `close()`, leaving native `readStreams` entries alive.
- **Beta is not marked in code.** No `@beta`, `@experimental` or equivalent anywhere in `src/` —
  §2's last question answered: it exists only in `PR_DESCRIPTION.md:196`.
- `processFileInChunks` exposes raw `bigint` in its public signature
  (`chunkIndex: bigint, position: bigint`, `_filestream.ts:441-443`) while every other public
  surface converts to `number`. It round-trips through `convertFs2StreamEventResultsToNitro`,
  which happens to work only because B4 left `chunk` unconverted.
- The checklist names the high-level helpers `readTextStream()` / `writeTextStream()`
  (`MIGRATION_CHECKLIST.md:53`); the code ships `readStream()` / `writeStream()`. Cosmetic, but it
  means the checklist was not re-read against the code.

---

## Native correctness (§3)

### §3a — buffer ownership: no defect found

I agree with the handoff's severity ranking but not its worry. The pattern is correct at all
seven sites: `asOwning()` is called **synchronously**, in the JS-thread scope, before the
`Promise.async` block is constructed — `ios/Fs2.swift:75,435`, `ios/Fs2Stream.swift:364`,
`Fs2.kt:183,218,253`, `Fs2Stream.kt:406`. `copiedBuffer` is only ever read inside the closure,
never mutated, and never escapes it. Since buffers arriving from JS are non-owning, `asOwning()`
copies them, which is exactly what the old unconditional copy did.

The iOS comment at `Fs2Stream.swift:362-363` is worth keeping — it is the reason the code is right.

### §3b — the second hierarchy bug: found, see B6

`MediaStore.kt:92` is it. Sweeping every `catch (e: Exception)` in `android/src/` (38 sites), I
found no case where an `FsError` is caught and re-wrapped: every catch either does
`throw reject(...)`, and `reject()` passes `JsVisibleError` through unchanged (`Fs2.kt:502`,
`MediaStore.kt:13`), or is a deliberate `catch (_: Exception)` cleanup swallow. The guard works.
B6 is a path that never goes through `reject()` at all.

### §3c — threading: found, see B9

---

## Cross-platform parity (§4)

- **`unlink('/missing')`** — confirmed deliberate on iOS (`ios/Fs2.swift:181-187`, with the
  comment explaining it). Still divergent from Android's `ENOENT`. Open decision #4 stands.
- **Unprefixed error messages break the contract in two places.** Every iOS MediaStore method
  throws `"Not supported on iOS"` (`ios/MediaStore.swift:6,10,14,18,22,26`) and Android's
  `scanFile` throws `"scanFile is not supported"` (`Fs2.kt:496`) — no `CODE:` prefix on either,
  so `err.message.startsWith('E…')` fails. The iOS stubs are the intended design
  (`TASKS.md:174`, Task 4.18.4: "dummy/no-op … as these are Android-only"); the missing prefix is
  not. Suggest `ENOTSUP:`.
- iOS-only options degrade by being dropped in the JS layer rather than no-op'ing natively (C4,
  C5, C6) — the less predictable of the two.

---

## Build and packaging (§5)

Nothing new. `nitrogen/` is gitignored at `.gitignore:100` (maintainer's call, open decision #3).
`package.json` minimums (`>=0.82.0`, nitro `^0.37.0`) match the README support table at
`README.md:43`. The only packaging-adjacent problem is C3 — `PR_DESCRIPTION.md` contradicting
`package.json`.

---

## Lower severity

- **`reject()` is typed `: Throwable` but never returns** (`Fs2.kt:500`, `MediaStore.kt:11`).
  It should be `Nothing`. Two consequences today: `Fs2.kt:244` is the only call site that does not
  `throw` the result, and it is correct *only* because the helper throws internally — one refactor
  to make `reject()` actually return and `appendFile` silently swallows every failure. And
  `Promise.rejected(reject(...))` at `Fs2.kt:186,221,256` is unreachable dead code; those three
  paths throw synchronously instead of returning a rejected promise. Typing it `Nothing` makes the
  compiler point at all four.
- **`encodeContents` assumes `Buffer#.buffer` is exactly the payload** (`src/utils.ts:28,34,40`) —
  it ignores `byteOffset`/`byteLength`. True for the `buffer` npm shim RN resolves
  (`package.json` dependencies), false for Node's pooled `Buffer`, so this breaks under any
  Node-based test or SSR path. Cheap to make robust with an explicit
  `.slice(byteOffset, byteOffset + byteLength)`.
- **`convertFs2StreamOptionsToNitroOptions` throws on explicit `undefined`**
  (`src/utils.ts:172-181`) — `{ start: undefined }` reaches `BigInt(undefined)` → `TypeError`.
  Filter nullish values before mapping.
- **`bigIntToNumber` precision** (§1c): `Number(bigint)` loses precision above 2^53. Only
  reachable at ~9 PB offsets — theoretical, no action needed, but it is the honest answer to §1c.

---

## Suggested order of work

1. **B3** — the one clear unintended functional regression: a working `master` API that now
   throws, with no tracking row anywhere.
2. **B4, B5, B6** — small, local, unambiguous. B4 is one character.
3. **C1** — resolve `completeHandlerIOS` / `MainBundlePath` (handoff open decision #1), then fix
   `README.md:130,531` either way. The `[N/A]` convention in `MIGRATION_CHECKLIST.md:43-44` is
   where the decision should be recorded.
4. **Rewrite `PR_DESCRIPTION.md` against the actual diff** — C2–C7 plus B2. It is currently worse
   than no guide, because C3 instructs a broken install and C2's example throws. Most of these are
   deliberate changes that simply never reached the consumer-facing document.
5. **B9** — serialise the iOS registries (an actor, or a dedicated serial queue) to match Android.
6. **B1** — finish the `[/]` download work, or restate the backward-compatibility claim to match
   what actually ships.
7. **B7, B8** — the streaming API's advertised use case (multi-GB, memory-efficient) is the one it
   handles worst. Reinforces §2's framing that this belonged in its own PR; splitting it out and
   shipping the migration alone remains a defensible option.
8. **Reconcile the planning docs with the branch.** `MIGRATION_CHECKLIST.md` and `TASKS.md` are
   stale in both directions — unchecked items that shipped, `[x]`/"COMPLETED" rows that are
   contradicted by the code (`:52` on listener cleanup, `:53` on helper names). They were useful
   here for establishing intent; they will not be next time unless refreshed.
9. Open decisions #2–#6 from the handoff are unchanged by this pass. #1 is resolved: the two APIs
   are genuinely gone, the removal was not tracked, and the README still advertises them.
