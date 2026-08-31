# PR Review Handoff — `nitro-migration` → `master`

**react-native-fs2 `3.3.4` → `4.0.0`** · a major release of a public npm library.

This routes a reviewer through the PR. It is ordered by **what has to be signed off**, hardest-to-reverse first — not by what changed most recently. Section 8 is a practical guide to navigating a diff that is mostly noise.

---

## What this PR ships

Three things landed together, which is the main structural criticism you can level at it:

1. **A native rewrite.** The entire bridge moves from the legacy RN architecture to Nitro Modules (JSI). Every filesystem call now crosses a new boundary.
2. **A new public streaming API**, marked beta — 21 new exports, ~490 lines (`src/_filestream.ts`).
3. **A toolchain upgrade** to React Native 0.87.1 and Nitro 0.37.0, plus a port of PR #105 (content-URI support).

A reviewer may reasonably ask whether the streaming API should have been a separate PR from the migration. It is new surface area, not a port, and it is the least-exercised code here.

---

## 1. Public API contract — the thing a major release lives or dies on

This is a library. The API contract is the product. Review this before any implementation detail.

### 1a. ⚠️ Two APIs appear to be removed without disclosure

`completeHandlerIOS(jobId)` and `MainBundlePath` exist in `master` (`src/index.ts:202`, `:369`) and are **absent from the entire branch** — not just from `src/`, but from `ios/`, `android/`, and the generated Nitro code. They are not relocated the way the MediaStore methods were.

`PR_DESCRIPTION.md` documents breaking type changes and MediaStore renames, but **neither of these appears in it.**

- `completeHandlerIOS` is the iOS background-download completion handler. Dropping it may leave background downloads unable to signal completion to the OS.
- `MainBundlePath` is a path constant consumers read.

**Confirm this independently, then decide:** restore them, or document them as intentional removals in the migration guide. Verify with:
```bash
git show master:src/index.ts | grep -n 'MainBundlePath\|completeHandlerIOS'
grep -rn 'completeHandlerIOS\|MainBundlePath' src/ ios/ android/src/ nitrogen/
```

### 1b. MediaStore moved off the default export

`createMediaFile`, `updateMediaFile`, `writeToMediaFile`, `copyToMediaStore`, `queryMediaStore`, `deleteFromMediaStore` and the `MEDIA_*` constants moved from the default export to a `MediaStore` named export (`src/_mediastore.ts`). Breaking, but a deliberate, coherent move.

*Check:* the migration guide covers this, and every removed name has a documented replacement.

### 1c. Type changes

`bigint` → `Int64` in the Nitro specs (commit `3440dc3`), plus MediaStore type renames and a changed `queryMediaStore` result shape (`contentUri` → `uri`).

*Check:* the JS-side conversions in `src/utils.ts` handle the `Int64`/`bigint` boundary, **especially file sizes above 2⁵³** where a `number` silently loses precision.

### 1d. Semver

Confirm every breaking change is listed in the migration guide, and that nothing breaking is described as "non-breaking" — `PR_DESCRIPTION.md` has an "API Improvements (Non-Breaking)" heading worth auditing against the real diff.

---

## 2. The streaming API (beta) — new public surface

`src/_filestream.ts`, 21 exports including `createReadStream`, `createWriteStream`, six `listenTo*` event subscriptions, and the higher-level `readStream`, `writeStream`, `copyFileWithProgress`, `processFileInChunks`.

This is the largest genuinely new thing in the PR and it has **no automated tests**. Worth reviewing as if it were its own PR:

- **Listener lifecycle.** Six `listenTo*` functions register native callbacks. Are they all removable? What happens if a component unmounts mid-stream — leak, or callback into a dead scope?
- **Stream cleanup on failure.** If a write stream errors or the app backgrounds mid-write, is the native handle released? Look for orphaned entries in the native `readStreams` / `writeStreams` maps.
- **Back-pressure.** `processFileInChunks` and `copyFileWithProgress` drive potentially multi-GB files. Is there anything preventing unbounded queueing?
- **Beta labelling.** If it ships as beta, that should be visible in the types or docs, not only in the PR description.

---

## 3. Native correctness — where a bug corrupts data rather than text

### 3a. Buffer ownership (highest severity in the PR)

`ios/Fs2.swift:75,435` · `ios/Fs2Stream.swift:364` · `Fs2.kt:182,217,252` · `Fs2Stream.kt:405`

Incoming JS `ArrayBuffer`s were previously copied unconditionally. They now use `asOwning()`, which returns the *same* buffer when it already owns its memory. **A wrong ownership judgement is a use-after-free, not a compile error.** Everything else in this PR can at worst produce a wrong string; this can crash or corrupt.

*Check:* `copiedBuffer` is never retained beyond the async closure that consumes it, and nothing mutates it. `asOwning()` is Nitro's own helper (`ArrayBuffer.swift:159`, `ArrayBuffer.kt:138`), so scrutinise the usage, not the helper.

*Not in scope:* `ArrayBuffer.copy(data:)` (`Fs2.swift:63,537`, `Fs2Stream.swift:236`) and `ArrayBuffer.copy(byteBuffer)` (`Fs2.kt:153,171`, `Fs2Stream.kt:274`) build owning buffers from raw bytes and are correctly left alone.

### 3b. Android error-type hierarchy

`android/.../utils/JsVisibleError.kt` and every `throw FsError(...)`.

`FsError` extends `Exception`; the `throw Error(...)` calls it replaced extended `java.lang.Error`, which is **not** an `Exception`. Those throws previously escaped `catch (e: Exception)` blocks. This already caused one regression — `touch()` failures reaching JS double-prefixed as `EUNSPECIFIED: ETOUCH: …` — fixed with a pass-through guard in both `reject()` helpers.

*Check:* any **other** `catch (e: Exception)` that now intercepts an `FsError` it previously did not. `StreamError` already extended `Exception` and is unchanged; only `FsError` sites changed hierarchy. This is the most likely site of a second bug of the same shape.

```bash
grep -rn 'catch (\(e\|_\): Exception)' android/src/
```

### 3c. Threading

Nitro calls arrive on the JS thread; the implementations hop to background queues/coroutines. Worth confirming that shared native state — the stream registries especially — is not mutated from two threads.

---

## 4. Cross-platform parity

A library promising one API across two platforms should behave the same on both. Known divergences:

- **`unlink('/missing')`**: iOS resolves, Android throws `ENOENT`. Pre-existing and deliberate on iOS (`ios/Fs2.swift:181-187`). Not introduced here, but it is a real inconsistency in a 4.0.0 and now is the moment to settle it.
- **Error messages** now start with the documented code on both platforms — but Android's carry a **trailing newline** (`println` inside fbjni's `printStackTrace` always appends one). `startsWith('ENOENT')` works; an exact `===` does not.
- **iOS-only options** (`mode`, `fileProtection`, `background`, `discretionary`, `cacheable`, `resumable`) and **Android-only MediaStore** methods are marked in the specs. Check they degrade predictably rather than silently no-op.

---

## 5. Build, packaging, release

- **`nitrogen/generated/**` is gitignored** and therefore absent from the diff entirely — contradicting Nitro's documented advice to commit generated code. Publishing is unaffected (`npm pack --dry-run`: 247 files, 174 of them generated, because `prepare: bob build` regenerates first). The costs are that generated API changes are invisible in review, and a consumer building from a git checkout must run nitrogen. **Maintainer's call; deliberately unchanged.**
- **Minimums moved**: peer `react-native >=0.82.0`, compileSdk 37, NDK 27.1.12297006, minSdk 24, Swift 6.3.1. Confirm these are stated in the README and are acceptable for the consumer base.
- `example/ios/Pods/**` and `package-lock.json` are committed regenerations, not authored changes.

---

## 6. Verification status — what is and isn't covered

**There is no automated test.** `src/__tests__/index.test.tsx` is a single `it.todo`. Everything below was verified manually and **nothing guards it against regression.**

Established, with method — challenge the conclusions, but you needn't re-run them:

| Claim | How it was established |
|---|---|
| Errors reach JS with the correct code prefix | On-device probe, 10 cases: Android 10/10, iOS 9/10 |
| Buffers survive `asOwning()` | Same probe: 200KB and 64KB payloads round-tripped through `writeFile`/`appendFile`/`writeToStream`, byte-compared, both platforms |
| Android previously mangled messages | fbjni `ExceptionHelper.getErrorDescription()` is `printStackTrace`; Nitro does `jsi::JSError(rt, e.what())` |
| The error fix works | JVM test against the real compiled `FsError`/`StreamError`: 6/6 clean |
| `nitro.json` syntax migration is inert | `diff -rq` on `nitrogen/` before and after: byte-identical |
| Both platforms build | iOS `** BUILD SUCCEEDED **`, 0 warnings in our files; `compileDebugKotlin` `BUILD SUCCESSFUL` |

The iOS 9/10 is the `unlink` divergence in §4, not a defect.

**Not covered by anything:**
- The entire streaming API beyond one happy-path round trip.
- Three `reject()` pass-through paths (`touch` failure, two MediaStore failures) — compile-verified only. Note the device probe would not have caught the original hierarchy regression either.
- Background downloads, and anything touching `completeHandlerIOS` (§1a).
- MediaStore on real Android storage.

### Reproducing the gates

```bash
rm -rf nitrogen/ && npx nitrogen     # no warning, "Generated 3/3 HybridObjects"
npx tsc --noEmit                     # exit 0

cd example/android && ./gradlew :react-native-fs2:compileDebugKotlin
# BUILD SUCCESSFUL; two pre-existing Fs2.kt:147,178 naming warnings are expected

cd ../ios && xcodebuild -workspace Fs2Example.xcworkspace -scheme Fs2Example \
  -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build
```

**Behavioural checks need a device or simulator; compiling proves nothing here.** If you build a probe: render its trigger button *above the fold* (AppleScript `AXPress` on an off-screen element reports success and silently does nothing), have it report each case *as it settles* (one hanging call otherwise hides every result), and read results by having it *write a file through the library* — the accessibility tree is unreliable and RN `console.log` does not reach `os_log`.

---

## 7. Open decisions for the maintainer

1. **§1a** — restore `completeHandlerIOS` / `MainBundlePath`, or document them as intentional removals?
2. Is suppressing Android stack traces acceptable for a clean `err.message`? (`JsVisibleError.fillInStackTrace()` returns `this`, costing logcat debuggability.) A JS-side normaliser was the considered alternative and was not chosen.
3. Should `nitrogen/` be committed, per Nitro's docs?
4. Should `unlink` of a missing path throw (Node `fs.unlink`) or no-op (Node `fs.rm({force:true})`)?
5. What value should `memorySize` take? It is `0` on all three HybridObjects, so the JS GC cannot see native memory held by large buffers.
6. Does a 4.0.0 ship with no automated tests?

---

## 8. Navigating the diff

`git diff master...nitro-migration` is 72 commits / 131 files / ~27,000 insertions. Most is not authored code.

| | Range | Size | Treatment |
|---|---|---|---|
| Dependabot | `git log master..a883109` | 58 commits | Skip — arrived via a `master` merge, reviewed upstream |
| Migration + upgrade | `git log a883109..nitro-migration` | 14 commits | Review |
| API audit fixes | `git diff` (uncommitted at time of writing) | 10 files + 1 new | Review |

Excluding `example/ios/Pods/**`, `package-lock.json` and `**/*.lock` removes most of the line count. The authored surface is:

```
src/{index,types,utils,_filestream,_mediastore}.ts
src/nitro/{Fs2,Fs2Stream,MediaStore}.nitro.ts
ios/{Fs2,Fs2Stream,MediaStore,Downloader,StreamError}.swift
android/src/main/java/com/margelo/nitro/fs2/**.kt
android/src/main/cpp/cpp-adapter.cpp
android/build.gradle, android/gradle.properties, package.json, nitro.json
```

> **Check `git status` first.** When this was written the last tranche was uncommitted (10 modified files plus `android/.../utils/JsVisibleError.kt`). If the tree is clean it has since been committed — review `git log master..nitro-migration` instead.

---

## 9. Background

- `docs/plans/2026-08-27-nitro-api-audit-findings.md` — the Nitro 0.37 API audit, with a re-verification pass, corrections, and a full verification log.
- `docs/plans/2026-08-27-wake-up-nitro-migration.md` — the RN 0.87.1 / Nitro 0.37.0 upgrade plan.
- `PR_DESCRIPTION.md` — the user-facing summary and migration guide. Audit it against §1; at least two removals are missing from it.
