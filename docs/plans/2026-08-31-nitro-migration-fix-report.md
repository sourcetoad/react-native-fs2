# Fix report — `nitro-migration` review findings

Work order: `docs/plans/2026-08-28-nitro-migration-fix-handoff.md`.
17 new commits on `nitro-migration`, one per item ID where the items were separable.

Nothing below was verified on a device. Where a fix is behavioural, this report says so
explicitly rather than letting a green build stand in for it.

---

## 1. Items fixed

| ID | Commit | What changed |
|---|---|---|
| — | `f2c8f82` | Committed the pre-existing 10-file API-audit tranche + `JsVisibleError.kt` so the rest is reviewable on top |
| — | `2a376a4` | `npm test` could not run at all: RN 0.87 dropped the jest preset from the `react-native` package. Added `@react-native/jest-preset` |
| B4 | `0125efc` | `mapPropsWithBigInt` said `'chunks'`; the field is `chunk` |
| B5 | `e30e3e3` | Split `reject()` into `fsError()` (builds) and `reject()` (`Nothing`, throws) |
| B6 | `5a9582c` | MediaStore "not found" resolves `undefined` instead of rejecting with a mangled `java.lang.Error` |
| B3 | `42067c7` | Ported `scanFile` from `RNFSManager.java:581` into Kotlin |
| EXTRA | `5a822f1` | Ported `getAllExternalFilesDirs` — same defect, two lines above `scanFile` |
| — | `301957f` | Tracked `PR_DESCRIPTION.md` as-is, so the corrections read as a diff |
| C3 | `896463a` | `^0.29.7` → `^0.37.0` (×3), `>=0.80` → `>=0.82.0` |
| B2 | `ff33ba7` | `readDir` items get `isFile()`/`isDirectory()` accessors, matching `stat` and 3.x |
| — | `dbbca6e` | `encodeContents` byteOffset/byteLength; nullish stream options |
| C1 | `6ce485c` | Restored `MainBundlePath` |
| B9 | `381d5cf` | All nine iOS stream registries guarded by one `NSLock` |
| Parity | `4ca3cf5` | `ENOTSUP:` prefix on the iOS MediaStore stubs and on `RNFSMediaStoreManager`'s five API-level guards |
| B7, B8, B-EXTRA | `1f568f0` | Streaming helpers: back-pressure, write ordering, single-pass assembly and decode, listener/stream cleanup, `@beta` |
| B1 | `a8b704c` | `headers` passed as the second argument; `discretionary`/`cacheable` forwarded; dead `resumable` removed; public options type fixed |
| C-README | `1ec8507` | README API reference and migration section corrected |
| C2/C5/C6/C7 | `0c41f8e` | `PR_DESCRIPTION.md` rewritten against the actual diff |

Also updated, **outside the git repo** so not in any commit:
`../MIGRATION_CHECKLIST.md` and `../TASKS.md`, reconciled in both directions.

## 2. Items skipped

None. Every item in the handoff was addressed.

`completeHandlerIOS` was **deferred by maintainer decision**, not skipped — recorded as `[N/A]`
in `../MIGRATION_CHECKLIST.md`, removed from the README, and its consequence for
`background: true` on iOS documented in both the README and the PR description.

The four "Out of scope" items were not touched: `asOwning()` usage, the iOS `unlink` no-op,
`nitrogen/` being gitignored, and the committed regenerations.

## 3. The three 🔴 decisions

All three were put to the maintainer. Recorded here with what the investigation found, since
two of the answers changed after the evidence came in.

### C1 — `completeHandlerIOS` and `MainBundlePath`
**Decision: restore `MainBundlePath`, defer `completeHandlerIOS`.**

`MainBundlePath` is `Bundle.main.bundlePath` — how you reach files shipped inside the app
bundle. It read `undefined`, so `RNFS.readFile(RNFS.MainBundlePath + '/seed.db')` was reading
the literal path `"undefined/seed.db"`. One spec line to restore.

`completeHandlerIOS` needs the background-session completion-handler registry plus an
AppDelegate hook consumers must wire up. Worth noting for the release: `ios/Downloader.swift:62`
*does* create `URLSessionConfiguration.background(withIdentifier:)`, so 4.0 opens background
sessions it cannot complete. That is now stated as a limitation rather than left implicit.

### B2 — `readDir` vs `stat` accessors
**Decision: accessors on both — `readDir` changed to match `stat` and 3.x.**

The break was confirmed, not assumed. Compiling a probe against the real `src/index.ts`:

```
b2probe.ts(5,23): error TS2349: This expression is not callable.
  Type 'Boolean' has no call signatures.
```

on `readDir(...)[0].isFile()`, while the same probe's `stat(...).isFile()` produced no error.
The same probe compiles clean now.

The plan (`TASKS.md:87`, `:95`) specified booleans for both, so `stat` was the drifted one — but
the shipped combination (booleans on `readDir`, functions on `stat`) was the one arrangement
that broke 3.x code while gaining nothing. Aligning on accessors removes the breaking change
entirely. `TASKS.md` now records this as superseding 4.7.1 and 4.8.1.

### B1 — download headers
**Decision: keep the two-parameter native shape, fix the JS wrapper. Forward
`discretionary` + `cacheable`, drop `resumable`.**

The premise in the handoff was wrong, and finding that out changed the fix.

`headers` was never removed from `DownloadFileOptions`. Checking every commit that has touched
the spec, it has **never** been a field of that struct — it was designed as a second top-level
parameter, `downloadFile(options, headers?)`, from the first migration commit, and both natives
implement exactly that (`ios/Downloader.swift:33`, `Fs2.kt:351,362`). The native design was
complete; only the JS wrapper was not.

The obvious hypothesis — Nitro cannot hold a map inside a struct — was tested by adding
`headers?: Record<string, string>` to `DownloadFileOptions` and building: nitrogen generated
`std::optional<std::unordered_map<std::string, std::string>>` plus a Swift bridge accessor,
Kotlin compiled, and the iOS example built. So both shapes are viable with nitrogen 0.37; the
two-parameter one was kept because it needs no spec, ABI or native change. Experiment reverted.

`resumable` was removed from the spec: grepping both platforms, nothing ever read it. Master's
`resumable` was a *callback*, which is `canBeResumed` now.

## 4. How each fix was verified

**Compile-verified only** (no runtime evidence at all):

- **B3** `scanFile` — Kotlin compiles. Whether the media scanner actually indexes a written
  file needs a device.
- **EXTRA** `getAllExternalFilesDirs` — same.
- **B5** — compiles. That an unwritable path now yields a rejected promise rather than a
  synchronous throw is not runtime-verified.
- **B6** — compiles, and `tsc` stays clean because the JS type already permitted `undefined`.
- **C1** `MainBundlePath` — nitrogen + both platform builds. That the path resolves correctly
  is not device-verified.
- **Parity** `ENOTSUP:` — both platforms compile.
- **B9** iOS registry locking — **the iOS example builds, and that is all.** A passing build
  says nothing about a data race. This one needs Thread Sanitizer (Xcode scheme → Diagnostics →
  Thread Sanitizer) on the example app's stream path. Until that is run, treat B9 as unverified.

**Verified by tests that fail on the pre-fix code** (still not device-verified):

- **B4** — a test pins every `Int64` field in the stream spec to the conversion list.
- **B2** — the TS probe above, plus unit tests for both `readDir` and `stat` mappings.
- **`encodeContents` / stream options** — 6 of the new `utils` tests fail against the pre-fix
  file and all pass after. `Buffer.from('hi','utf8').buffer` is 8192 bytes under Node; the
  payload is 2.
- **B7, B8, B-EXTRA** — 9 of the 12 new `filestream` tests fail against the pre-fix file. The
  harness reproduces the property that causes the bugs: it emits every chunk synchronously
  without awaiting the data callback, exactly as both native read loops do. That is a faithful
  model, not the real thing — the ordering fix is not proven against a real native layer.
- **B1** — the probe that now compiles, plus six tests asserting the two-argument call, the
  headers payload, uncoerced `discretionary`/`cacheable`, and jobId allocation.

**Documentation** (C3, C2, C5, C6, C7, C-README) — cross-checked against `package.json` and the
code, not against the documents' own other claims.

### Verification gates

```
$ rm -rf nitrogen/ && npx nitrogen
🎉  Generated 3/3 HybridObjects in 1.4s!

$ npx tsc --noEmit
tsc: exit 0

$ npx jest
Test Suites: 3 passed, 3 total
Tests:       47 passed, 47 total

$ npx eslint "src/**/*.ts" "src/**/*.tsx"
eslint: clean

$ ./gradlew clean :react-native-fs2:compileDebugKotlin
BUILD SUCCESSFUL in 12s
```

Three Kotlin warnings, all pre-existing: `Fs2.kt:149,180` parameter naming (the handoff
predicted these at `:147,178` — same two, shifted by edits), and `RNFSManager.kt:209`
(`algorithms[...]` is `String?` passed to `MessageDigest.getInstance(String)`). That third one
only appeared once `RNFSManager.kt` recompiled for the first time; it is untouched by this work.

```
$ xcodebuild -workspace Fs2Example.xcworkspace -scheme Fs2Example \
    -sdk iphonesimulator -configuration Debug \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build
** BUILD SUCCEEDED **
```

Two warnings from this module's own sources, both pre-existing: `Fs2.swift:322` (`CC_MD5`
deprecated since iOS 13) and `Fs2Stream.swift:119` (unused `try?` in `createWriteStream`,
untouched by the B9 change).

## 5. Found and not in the handoff

1. **`getAllExternalFilesDirs` threw on Android**, two lines above `scanFile`, with the identical
   defect and the identical cause — missed in the Java→Kotlin conversion, no checklist row, no
   `[N/A]`. Ported and committed separately (`5a822f1`) so it can be dropped independently.

2. **`RNFS.downloadFile({ fromUrl, toFile })` did not compile.** The public options type was the
   raw Nitro struct, whose `jobId` is required — but the wrapper allocates its own jobId and
   ignores whatever is passed. The example app was passing a throwaway `Date.now()` purely to
   satisfy the type. This is larger than the headers bug it was found next to: the download API
   was unusable from TypeScript without that workaround.

3. **`nitroOptions` also dropped `discretionary` and `cacheable`**, both of which iOS genuinely
   reads (`Downloader.swift:63,70,110`). They must be passed through uncoerced — iOS disables the
   shared cache only on an explicit `cacheable: false`, so `!!options.cacheable` would have
   changed behaviour for anyone who left it unset.

4. **`resumable` is a dead spec field.** Declared, documented as an iOS option, read by nothing
   on either platform. Removed.

5. **`npm test` was broken before a single test ran.** RN 0.87 moved the jest preset out of the
   `react-native` package, so the suite failed with a validation error. The repo's only test was
   an `it.todo`, so nothing noticed.

6. **`RNFSMediaStoreManager.kt` throws five unprefixed `UnsupportedOperationException`s** that
   `MediaStore.fsError` forwards to JS verbatim — the same error-contract violation as the
   Parity item, in a file the review explicitly listed as unaudited. Prefixed, and the message
   now names the actual requirement (Android 10 / API 29). **Treat the rest of that file as
   still unreviewed.**

7. **The README was wrong well beyond C1.** Every MediaStore example called
   `RNFS.MediaStore.…` (throws — it is a named export now), `moveFile`/`copyFile` were
   documented with an `options` parameter they no longer take, `mkdir`'s option keys were the
   pre-rename ones, and `scanFile` was shown as `scanFile('FilePath', Date, Date)`. All
   corrected.

8. **`ReadStreamState`/`WriteStreamState` mutable fields are still racy on iOS.** `isActive`,
   `isPaused`, `position` and `task` are read and written across the same thread boundary B9
   addresses. Left alone deliberately: they are scalar fields on a class instance, not a
   container that can corrupt its own storage, and fixing them properly means restructuring the
   state objects. Worth a follow-up.

9. `dev/RNFSMediaStoreManager.java` is an untracked reference copy of master's Java file. Left
   untracked — it is not part of the deliverable, but it is also not in `.gitignore`.

## 6. Still unreviewed

Unchanged from the review's own caveat: `Downloader.kt`/`.swift` internals, `RNFSManager.kt`
beyond the two methods ported here, `cpp-adapter.cpp`, and the MediaStore query internals were
not audited. Finding 6 above is the first thing to come out of `RNFSMediaStoreManager.kt` and it
was found incidentally, which suggests the file is worth a real pass.
