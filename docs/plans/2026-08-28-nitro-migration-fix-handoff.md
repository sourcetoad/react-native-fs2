# Fix handoff — `nitro-migration` review findings

**For an implementing agent.** Findings and evidence live in
`docs/plans/2026-08-28-nitro-migration-review-findings.md`; PR context lives in
`docs/plans/2026-08-28-nitro-migration-review-handoff.md`. Read this file first — it is the work
order. Read the findings doc for the reasoning behind any item you are about to touch.

Work will be reviewed after the fact. Optimise for **small, separately reviewable commits**, one
per item ID below, with the ID in the commit message (e.g. `fix(B4): convert chunk from Int64`).

---

## Ground rules

1. **Do not fix by deletion.** Removing an API, a listener, or a test to make a symptom go away is
   not a fix here. If an item cannot be fixed as described, stop and report it.
2. **Do not touch the four things listed under "Out of scope"** below. They are correct, or they
   are the maintainer's call.
3. **Items marked 🔴 DECISION need a human answer before you write code.** Do the mechanical
   items first; surface the decisions together and wait.
4. **`nitrogen/generated/**` is gitignored and derived.** Never hand-edit it. If you change a
   `.nitro.ts` spec, re-run `npx nitrogen` and expect native signature changes to follow.
5. **State what you verified and how.** Nothing in the review below was verified on a device —
   neither should you claim it was. "Compiles" is not "works". Say which.

---

## Out of scope — do not change

| Thing | Why |
|---|---|
| `asOwning()` usage at `ios/Fs2.swift:75,435`, `ios/Fs2Stream.swift:364`, `Fs2.kt:183,218,253`, `Fs2Stream.kt:406` | Reviewed and correct. Called synchronously before the async block, never mutated, never escapes. The iOS comment at `Fs2Stream.swift:362-363` explains why — keep it. |
| iOS `unlink` no-op on missing path (`ios/Fs2.swift:181-187`) | Deliberate, pre-existing, and a maintainer decision (handoff open decision #4). |
| `nitrogen/` being gitignored (`.gitignore:100`) | Maintainer decision (handoff open decision #3). |
| `example/ios/Pods/**`, `package-lock.json`, `**/*.lock` | Committed regenerations, not authored code. |

---

## Phase 1 — mechanical fixes (no decisions needed)

Do these first. Each is small and self-contained.

### B4 — `chunk` reaches JS as a `bigint`
`src/utils.ts:161`

`mapPropsWithBigInt` contains `'chunks'`; the field is `chunk`
(`src/nitro/Fs2Stream.nitro.ts:27`). No event anywhere has a `chunks` field, so the entry is dead
and `chunk` is never converted — subscribers get a `bigint` where `src/types.ts:43` promises
`number`, and `event.chunk + 1` throws.

**Fix:** `'chunks'` → `'chunk'`.

**Watch out:** `processFileInChunks` (`src/_filestream.ts:453-462`) currently round-trips the event
back through `convertFs2StreamEventResultsToNitro` and relies on `chunk` *not* having been
converted. Once B4 lands, confirm that path still yields `bigint` for its documented
`chunkIndex: bigint` signature — or fold it into the B-EXTRA item below and make the whole surface
`number`.

**Verify:** `npx tsc --noEmit`, plus a unit test asserting `typeof event.chunk === 'number'` for a
representative `ReadStreamDataEvent`.

### B5 — `reject()` is typed `Throwable` but always throws
`android/.../Fs2.kt:500`, `android/.../MediaStore.kt:11`

All four branches (`Fs2.kt:503,506,510,513`) are `throw`; nothing returns. Consequences:
`Promise.rejected(reject(...))` at `Fs2.kt:186,221,256` is unreachable dead code (those paths
throw synchronously instead of returning a rejected promise), and `Fs2.kt:244` is the lone call
site that doesn't `throw` the result — correct today only by accident of the helper's behaviour.

**Fix:** change both return types to `Nothing`. The compiler will then flag every affected call
site. At each one, decide deliberately: `throw reject(...)` stays (now redundant but harmless and
explicit), and the three `Promise.rejected(reject(...))` sites must become real rejected promises
— construct the `FsError` directly rather than routing through `reject()`.

**Verify:** `./gradlew :react-native-fs2:compileDebugKotlin`. Confirm `writeFile`/`appendFile`/
`write` with an unwritable path produce a **rejected promise**, not a synchronous throw.

### B6 — MediaStore "not found" throws a mangled, unprefixed error
`android/.../MediaStore.kt:91-92`

```kotlin
println("File not found: ${searchOptions.fileName}")
queryPromise.reject(Error("File not found: ${searchOptions.fileName}"))
```

Three problems: bare `java.lang.Error` bypasses `JsVisibleError`, so fbjni's `printStackTrace`
path mangles the message (the exact breakage `JsVisibleError.kt` exists to prevent); no `CODE:`
prefix; and a stray `println`.

**Fix:** delete the `println`. Then resolve the contract question — the spec types this
`Promise<MediaStoreFile | undefined>` (`src/nitro/MediaStore.nitro.ts:54`,
`src/_mediastore.ts:70`), so "not found" should **resolve `undefined`**, not reject. Prefer
`queryPromise.resolve(null)`. If you instead keep it a rejection, it must be
`FsError("ENOENT: ...")`.

**Verify:** compiles; and the JS-side type already permits `undefined`, so `npx tsc --noEmit`
should stay clean.

### B3 — `scanFile` throws on Android where `master` worked
`android/.../Fs2.kt:495-497`

`Promise.async { throw FsError("scanFile is not supported") }`. `master` implements it via
`MediaScannerConnection.scanFile` (`master:android/src/main/java/com/rnfs2/RNFSManager.java:581`).
The Kotlin helper `RNFSManager.kt` **has no `scanFile` at all** — it was missed in the Java→Kotlin
conversion, and the throw is standing in for the absent helper.

**Fix:** port the Java implementation into `RNFSManager.kt` and delegate from `Fs2.kt`, matching
how every other Android method delegates. Note `master`'s version is callback-based
(`MediaScannerConnection.scanFile(context, paths, mimeTypes, listener)`); it needs bridging to the
`Promise<Array<String>>` return. iOS correctly returns `[]` (`Fs2.swift:748-752`) — leave it.

**Verify:** compiles. Device verification (that a written file actually appears in the media
scanner) is out of reach here — say so rather than implying otherwise.

### C3 — migration guide names the wrong dependency versions
`PR_DESCRIPTION.md:52,162,207,208`

Says `react-native-nitro-modules@^0.29.7` and "React Native: >=0.80". Actual, per
`package.json:108-112`: `^0.37.0` and `>=0.82.0`. Following line 162 installs an incompatible
Nitro.

**Fix:** correct all four. Cross-check against `package.json` rather than against this document.

---

## Phase 2 — needs a decision first

### 🔴 C1 — `completeHandlerIOS` and `MainBundlePath` are gone
Handoff open decision #1. Confirmed absent from `src/`, `ios/`, `android/`, and `nitrogen/`; still
documented in `README.md:130` (with signature) and `README.md:531`.

Evidence they were **unintended**: `MIGRATION_CHECKLIST.md:43-44` shows the project's convention
for deliberate removals (`[N/A]` rows for `pathForBundle`/`pathForGroup`, "Not needed in Nitro
module"). Neither of these got one. `../ios_native_analysis.md:80` lists `RNFSMainBundlePath` among
the constants to port, and `TASKS.md:185` requires constants to "match the original library's
behavior".

**Ask the maintainer:** restore both, or record them as intentional removals?

- `MainBundlePath` is cheap to restore — one `readonly mainBundlePath: string` on the Fs2 spec,
  `Bundle.main.bundlePath` on iOS, `null`/empty on Android like the other platform-specific
  constants.
- `completeHandlerIOS` is not cheap. It requires the background-session completion-handler
  registry described in `../ios_native_analysis.md:69`. Scope it before committing to it.

Either way, `README.md:130,531` must stop advertising what does not exist.

### 🔴 B2 — `readDir` vs `stat` disagree on `isFile`/`isDirectory`
`readDir` returns plain booleans (`src/nitro/Fs2.nitro.ts:7-8`, passthrough at
`src/index.ts:112-114`); `stat` returns functions (`src/types.ts:23-24`, mapped at
`src/index.ts:125-126`). `master` used functions for both, so `items[0].isFile()` now throws.

`TASKS.md:87` and `:95` specify **booleans for both** — so `readDir` is on-plan and `stat` is the
one that drifted.

**Ask the maintainer:** which shape wins? Consumer-compat argues for functions on both (matching
`master`); the plan and Nitro's struct model argue for booleans on both. Do **not** pick
unilaterally — this is the public API of a major release.

Whichever way it goes, it must land in `PR_DESCRIPTION.md`. Today `:88-94` documents the timestamp
change *on this very type* and says nothing about the accessors, and `:190` tells people to test
only `mtime`/`ctime`.

### 🔴 B1 — download headers never reach native
`src/index.ts:283` calls `RNFS2Nitro.downloadFile(nitroOptions)` with one argument. The generated
ABI takes two — `HybridFs2Spec.hpp:100`, `.kt:130`, `.swift:39` — and **both platforms implement
headers** (`ios/Downloader.swift:33,74-75`; `android/.../Fs2.kt:351,362`). Because the parameter is
optional, it fails silently. `headers` was also dropped from the branch's `DownloadFileOptions`
(`src/nitro/Fs2.nitro.ts:46-59`).

`MIGRATION_CHECKLIST.md:40` marks `downloadFile` `[/] In Progress`, so this is known-incomplete
work rather than a surprise.

**The fix itself is small** — restore `headers?: Record<string, string>` to the options type and
pass it as the second argument. **The decision is scope:** is finishing the `[/]` download work in
this PR, or is `PR_DESCRIPTION.md:69-70,82` ("100% backward compatible", "the public API is
unchanged") being corrected instead? One of the two must change; ask which.

Related and undocumented either way: `master`'s `resumable` **callback** became `canBeResumed`,
while `resumable` is now an unrelated boolean that `nitroOptions` (`src/index.ts:269-279`) never
forwards — so old `resumable: () => {}` code silently never fires.

---

## Phase 3 — streaming API

Treat as one work item; the pieces interact. `MIGRATION_CHECKLIST.md:54` marks the native stream
layer `[/] PENDING` (stale — it is implemented), which is consistent with these clustering here.

### B9 — iOS stream registries are unsynchronised
`ios/Fs2Stream.swift:43-44` (`readStreams`, `writeStreams`) and `:52-58` (seven listener maps) are
plain Swift `Dictionary`. The read loop is `Task(priority: .background)` (`:195`) and reads the
listener maps at `:122,140,153,238,250,262,268`; `listenTo*` writes them at `:447-477` from the JS
thread. `readStreams`/`writeStreams` are mutated inside `Promise.async` at `:73,279,329` and read
at `:171,292,308,352,367`.

Android is already correct — `ConcurrentHashMap` throughout (`Fs2Stream.kt:46-64`).

**Fix:** guard all nine dictionaries. `BufferPool` in the same file already models the pattern with
an `NSLock` (`ios/BufferPool.swift:14`) — following it is the lowest-risk option. An `actor` is
cleaner but forces `await` at every access and will ripple.

**Verify:** compiles; then run the example app's stream path under **Thread Sanitizer** (Xcode
scheme → Diagnostics → Thread Sanitizer). TSan is the only way to demonstrate this one; a passing
run without it proves nothing.

### B7 — `copyFileWithProgress` has no back-pressure and can reorder writes
`src/_filestream.ts:390-400`

The data listener is `async` and awaits `writeStream.write()`, but native never awaits the
callback: `Fs2Stream.swift:238` invokes it synchronously inside `while state.isActive`, then
immediately advances and reads the next chunk. So:

- **Unbounded queueing** — nothing calls `readStream.pause()`. The only throttle that exists is
  `state.isPaused` (`Fs2Stream.swift:199-203`), unused here.
- **Reordering** — confirmed on Android: `Promise.async` runs on
  `CoroutineScope(Dispatchers.Default)` (`node_modules/react-native-nitro-modules/.../Promise.kt:130,141-146`),
  a thread pool. Concurrent `writeToStream` calls land on different threads and race to
  `impl.queue.add` (`Fs2Stream.kt:424`). Issue order is not preserved, so the destination file can
  be assembled out of order.
- **Leak** — `writeStream.close()` runs on completion; `readStream` is never closed.

**Fix:** serialise. The minimal correct version chains writes through a promise queue in JS so at
most one `write()` is in flight, and pauses the read stream when the queue depth exceeds a bound,
resuming on drain. Close **both** streams on every exit path.

**This is the highest-value item in Phase 3** — it is the only one that can silently corrupt a
user's file. If you fix nothing else here, fix this.

### B8 — `readStream()` corrupts multi-byte text and is quadratic
`src/_filestream.ts:285-302`

- Hardcoded `bufferSize: 128`. A 10 MB file emits ~78,000 callbacks, each running
  `concatenateArrayBuffers` (`:267-276`), which reallocates and copies the full accumulated buffer
  every time — ~390 GB of memcpy for that 10 MB file.
- Each 128-byte chunk is decoded **independently** (`:296`), so a UTF-8 sequence straddling a chunk
  boundary decodes as two invalid fragments. Any non-ASCII file read via `readStream(path,'utf8')`
  returns replacement characters. **This is a correctness bug, not a perf note.**

**Fix:** raise the default buffer size to something sane (16–64 KB); accumulate chunks in an array
and concatenate **once** at the end; and decode **once** over the assembled buffer rather than
per chunk. Decoding per chunk is only safe with a streaming decoder that carries state across
boundaries — simpler to assemble first.

### B-EXTRA — smaller streaming items
Fix alongside the above:

- **Leaked error listeners.** `readStream` (`:305-309`), `writeStream` (`:336-339`) and
  `processFileInChunks` (`:472-476`) unsubscribe data/end on success but never
  `unsubscribeError`.
- **Streams never closed on the happy path.** `readStream` and `processFileInChunks` resolve
  without `close()`, orphaning native `readStreams` entries.
- **Single-subscriber registries.** `listenTo*` stores one callback per `(streamId, event)` —
  `ios/Fs2Stream.swift:447`, `Fs2Stream.kt:528`, both `map[streamId] = cb`. A second subscription
  silently evicts the first, and either unsubscribe removes whichever is current. The `() => void`
  return implies multi-subscriber semantics that do not exist. Either make the value a list, or
  document the single-subscriber constraint. Note `MIGRATION_CHECKLIST.md:52` currently claims
  "All event listeners implemented with proper cleanup".
- **`processFileInChunks` leaks `bigint` into its public signature** (`:441-443`) while the rest of
  the surface uses `number`. Align it — and see the B4 note.
- **Beta is unmarked in code.** No `@beta`/`@experimental` anywhere in `src/`; it exists only in
  `PR_DESCRIPTION.md:196`. Add JSDoc `@beta` to the exported stream functions.

---

## Phase 4 — documentation

### C2, C5, C6, C7 + whatever B1/B2 resolve to — rewrite the migration guide
`PR_DESCRIPTION.md`

The guide is currently worse than no guide: C3 instructs a broken install, and its own "After
(v4.x)" example at `:107` calls `RNFS.MediaStore.queryMediaStore(...)`, which throws because
`compat` has no `MediaStore` key — MediaStore moved to a named export (`src/index.ts:311`) and
that move is **not mentioned anywhere in the document**.

Undocumented breaking changes to add:

| Change | Location |
|---|---|
| MediaStore moved to a named export | `src/index.ts:311` |
| `MkdirOptions` keys renamed: `NSURLIsExcludedFromBackupKey`→`excludedFromBackup`, `NSFileProtectionKey`→`fileProtection` (old keys silently ignored) | `src/nitro/Fs2.nitro.ts:33-37` |
| `moveFile`/`copyFile` lost their `options` parameter — deliberate per `MIGRATION_CHECKLIST.md:18-19` ("Options initially omitted"), still breaking | `src/nitro/Fs2.nitro.ts:88-89` |
| `downloadFile`: `resumable` callback → `canBeResumed` | `src/index.ts:259` |
| `queryMediaStore` return type gained `\| undefined` | `src/_mediastore.ts:70` |
| `readDir` accessors (per the B2 decision) | — |

Also delete or rewrite the claims contradicted by the diff: `:45` ("Mostly Backward Compatible!"),
`:56` ("API Improvements (Non-Breaking)"), `:69-70` and `:82` (download "100% backward
compatible"), `:225` ("only minor type changes for timestamps"). Deliberate breaking changes are
still breaking changes.

### C-README — `README.md`
Remove or correct `:130` (`completeHandlerIOS`, with signature) and `:531` (`MainBundlePath`) per
the C1 decision.

### Parity — unprefixed error messages
`ios/MediaStore.swift:6,10,14,18,22,26` throw `"Not supported on iOS"` and `Fs2.kt:496` throws
`"scanFile is not supported"` — no `CODE:` prefix, so `err.message.startsWith('E…')` fails. The
iOS stubs themselves are intended (`TASKS.md:174`); the missing prefix is not. Prefix both with
`ENOTSUP:`. (`Fs2.kt:496` disappears if B3 is fixed.)

---

## Phase 5 — housekeeping

- **Commit the tranche.** The working tree still holds 10 modified files plus
  `android/.../utils/JsVisibleError.kt` untracked. Commit before or alongside your work so the
  diff is reviewable.
- **`encodeContents` ignores `byteOffset`/`byteLength`** (`src/utils.ts:28,34,40`) — assumes
  `Buffer#.buffer` is exactly the payload. True for the `buffer` npm shim RN resolves, false for
  Node's pooled `Buffer`, so it breaks under Node-based tests or SSR. Add an explicit
  `.slice(byteOffset, byteOffset + byteLength)`.
- **`convertFs2StreamOptionsToNitroOptions` throws on explicit `undefined`**
  (`src/utils.ts:172-181`) — `{ start: undefined }` reaches `BigInt(undefined)`. Filter nullish
  values before mapping.
- **Reconcile the planning docs.** `../MIGRATION_CHECKLIST.md` and `../TASKS.md` are stale in both
  directions: unchecked items that shipped (`getFSInfo` `:35`; MediaStore `TASKS.md:171-176`;
  native streams `:54`) and `[x]`/"COMPLETED" rows the code contradicts (`:52` listener cleanup,
  `:53` helper names `readTextStream`/`writeTextStream` vs the shipped `readStream`/`writeStream`).
- **Tests.** `src/__tests__/index.test.tsx` is a single `it.todo`; there is no automated test in
  the repo (handoff open decision #6). At minimum, add unit tests for the items that are testable
  without a device: B4 (`chunk` is a `number`), B8 (UTF-8 across a chunk boundary; large-input
  assembly), `encodeContents`/`decodeContents` round-trips, and `convertFs2Stream*` conversions.
  These are exactly the regressions that would otherwise recur silently.

---

## Verification gates

Run before reporting done. Quote actual output; do not paraphrase.

```bash
rm -rf nitrogen/ && npx nitrogen     # expect: no warning, "Generated 3/3 HybridObjects"
npx tsc --noEmit                     # expect: exit 0

cd example/android && ./gradlew :react-native-fs2:compileDebugKotlin
# expect: BUILD SUCCESSFUL. Two pre-existing Fs2.kt:147,178 naming warnings are expected.

cd ../ios && xcodebuild -workspace Fs2Example.xcworkspace -scheme Fs2Example \
  -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build
```

**Compiling proves nothing about behaviour here.** B3, B7, B8 and B9 are all behavioural. If you
cannot verify one on a device or simulator, say plainly that it is unverified — do not let a green
build stand in for it. B9 in particular needs Thread Sanitizer, not a normal run.

If you build a probe app, the traps recorded in the review handoff (§6) still apply: render the
trigger button above the fold, report each case as it settles, and read results by writing a file
through the library rather than trusting the accessibility tree or `console.log`.

---

## Report back with

1. Which item IDs you fixed, one commit each.
2. Which you skipped, and why.
3. The three 🔴 decisions, with your recommendation — but not a unilateral choice.
4. For each fix: how it was verified, and explicitly which are **compile-verified only**.
5. Anything you found that is not in this list. The review covered §1–§5 of the review handoff and
   did **not** audit `Downloader.kt`/`.swift` internals, `RNFSManager.kt`, `cpp-adapter.cpp`, or
   the MediaStore query internals — treat those as unreviewed rather than clean.
