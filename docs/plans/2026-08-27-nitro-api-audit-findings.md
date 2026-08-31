# Nitro API Audit — Findings and Follow-Up Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Context:** Follow-up to `2026-08-27-wake-up-nitro-migration.md`, which is **complete and pushed** (branch `nitro-migration`, tip `18fbad0`, tag `pre-wakeup-2026-08-27` marks the pre-wake state). That plan brought the branch to React Native 0.87.1 and Nitro 0.37.0 and ported PR #105.

This document records a **full sweep of Nitro API usage against the official docs** (`https://nitro.margelo.com/llms.txt`, fetched 2026-08-27) performed after that work landed. It is the outstanding half of the pending item *"Ensure we're using latest Nitro Module API and setup"*.

**Nothing in this document has been implemented.** The branch is in the state described by the previous plan.

**Claim tags:** **[verified]** = checked directly this session, trust it. **[unverified]** = your job to confirm at that step. **[re-verified 2026-08-28]** = independently re-checked against sources; see the verification log at the bottom.

> **Re-verification pass, 2026-08-28.** Every claim below was re-checked against `node_modules`, fbjni sources, and the working tree. The mechanisms and file:line references hold, with **four corrections** now folded in: Finding 1's Android half was wrong, Finding 2's rebuild note was wrong, Finding 4 should use a built-in helper, and Finding 5's `ignorePaths` item is a real latent bug rather than cosmetic. Corrections are marked **[correction 2026-08-28]**.

---

## Environment notes carried over

- Gradle module is `:react-native-fs2`; build from `example/android`.
- Android emulator AVD `Pixel_9_Pro_XL`; iOS sim `iPhone 17 Pro Max` (`526D88B7-9F5D-4807-B871-EB70DE73961A`), bundle id `fs2.example`.
- **iOS UI cannot be driven by coordinates.** `screencapture` is blocked and there is no `idb`/`cliclick`. What works: AppleScript `System Events` → find the `button` whose `description` is e.g. `"Run Example5"` → `perform action "AXPress"`. Read results the same way via each element's `description` (**not** `value`, which is `missing value`). Full recipe is in the session transcript; rebuild it rather than retrying coordinate taps.
- Android UI drives fine with `adb shell input tap` plus `adb exec-out screencap -p`.
- Disk was at 100% mid-session; a full Android + iOS build needs several GB free.

---

## Finding 1 — thrown error messages reach JS mangled on **both** platforms *(the only user-visible bug)*

**[verified] Mechanism.** Nitro converts a thrown Swift `Error` using `String(describing: self)` — see `Error.toCpp()` in `node_modules/react-native-nitro-modules/ios/core/RuntimeError.swift`. That uses `CustomStringConvertible.description` and **ignores `LocalizedError.errorDescription`**.

**[verified] Measured** by running both cases through `swift`:

| Thrown | What JS receives |
|---|---|
| `StreamError.invalidStream(streamId: "abc")` | `invalidStream(streamId: "abc")` |
| `NSError(domain: "Fs2Stream", code: 0, userInfo: [NSLocalizedDescriptionKey: "ENOENT: …"])` | `Error Domain=Fs2Stream Code=0 "ENOENT: …" UserInfo={NSLocalizedDescription=ENOENT: …}` |
| `RuntimeError.error(withMessage: "ENOENT: …")` | `ENOENT: …` |

**Impact on iOS.** The `ENOENT`/`EACCES`/`EPIPE` message table in `ios/StreamError.swift` is discarded on the throw path. **[correction 2026-08-28]** It is *not* wholly dead code: `errorDescription` is used correctly for the two stream-error **event** payloads at `ios/Fs2Stream.swift:142` and `:270` (both `.ioError`). It is dead only for the 10 `throw StreamError` sites.

### **[correction 2026-08-28]** Android is broken too — the original claim here was wrong

The audit originally said Android's `reject()` produces a clean `CODE: message`, so `err.message.startsWith('ENOENT')` works there. **It does not.** The full path, source-verified end to end:

1. `Fs2.kt:499` throws `Error("ENOENT: no such file or directory, open '…'")` — correct so far.
2. Generated `nitrogen/generated/android/c++/JHybridFs2Spec.cpp:149` wraps the `Throwable`: `jni::JniException __jniError(__throwable); __promise->reject(std::make_exception_ptr(__jniError));`
3. fbjni `JniException : public std::exception` (`Exceptions.h:77`), and its `what()` calls `populateWhat()` (`Exceptions.cpp:427`) → `ExceptionHelper.getErrorDescription(throwable)`.
4. That Java method's **entire body** is `throwable.printStackTrace(new PrintWriter(stringWriter)); return stringWriter.toString();`
5. Nitro's `cpp/jsi/JSIConverter+Exception.hpp:41` then does `jsi::JSError(runtime, e.what())`.

So JS receives:

```
java.lang.Error: ENOENT: no such file or directory, open '/definitely/missing'
	at com.margelo.nitro.fs2.Fs2$…
	at …
```

`startsWith('ENOENT')` fails. There is no normalisation in `src/` either — messages pass through raw.

**Revised impact.** The `ENOENT`-prefix contract of the public 4.x API is broken on **both** platforms, in two different ways. This is not a cross-platform inconsistency to be fixed by bringing iOS up to Android's level; there is no good level to bring it to.

**Confidence.** Source-verified end to end, not device-confirmed. The one step not read directly is that `Throwable.toString()` yields `java.lang.Error: <message>` — standard JVM/ART behaviour.

**[verified] Scope:** 51 `throw NSError` sites — `Fs2.swift` 37, `Fs2Stream.swift` 8, `MediaStore.swift` 6 — plus 10 `throw StreamError` in `Fs2Stream.swift`.

**[verified] Docs prescribe** `throw RuntimeError.error(withMessage: "…")`. We never use it.

### Fix

**Step 1:** Make `StreamError` carry its message through `description`, preserving the existing strings:

```swift
enum StreamError: LocalizedError, CustomStringConvertible {
    // …cases unchanged…
    var errorDescription: String? { /* unchanged table */ }
    var description: String { errorDescription ?? "Unknown stream error" }
}
```

**Step 2:** Replace `throw NSError(domain:code:userInfo:)` with `throw RuntimeError.error(withMessage: …)`, keeping each existing message string verbatim so the `CODE: message` shape is preserved. Check each site: some pass a code that is currently discarded anyway.

**Step 3 — [correction 2026-08-28] Android needs its own fix; steps 1–2 alone do not close this.** Pick one:

- **(a) Normalise in JS** — the only fix that covers both platforms with one change. There is currently no error handling in `src/`; add a helper that strips a leading `java.lang.<Class>: ` and truncates at the first newline, and route every `Promise` rejection from the Nitro layer through it. Cheapest, and it keeps native code idiomatic per-platform.
- **(b) Fix natively on both sides** — iOS via steps 1–2, Android by wrapping throws in a `Throwable` subclass that overrides **both** `fillInStackTrace()` (returns `this`, dropping the frames) and `toString()` (returns the bare message, dropping the `java.lang.<Class>: ` prefix). `printStackTrace` emits `println(this)`, so overriding `toString()` is what removes the prefix.

> **[correction 2026-08-28, second pass]** An earlier draft of this step claimed (b) could not remove the class-name prefix and so could not fully fix Android. **That was wrong** — overriding `toString()` does remove it. Measured on a JVM against the real compiled classes:
>
> | Approach | What JS receives | `startsWith('ENOENT')` |
> |---|---|---|
> | `throw Error(msg)` (old) | `java.lang.Error: ENOENT: …\n\tat …` | ✗ |
> | `fillInStackTrace()` only | `…FsError: ENOENT: …\n` | ✗ |
> | `fillInStackTrace()` + `toString()` | `ENOENT: …\n` | ✓ |
>
> Only a single trailing newline survives, which `println` unavoidably adds.

**(b) was chosen and implemented.**

**Step 4 — verification is mandatory and must be behavioural, not a compile.** Add a temporary button (or reuse an example) that triggers a known failure — e.g. `RNFS.stat('/definitely/missing')` and a `writeToStream` against a closed stream id — and confirm JS sees `ENOENT: …` on **both** platforms, not `Error Domain=`, `invalidStream(…)`, or `java.lang.Error: …`. Remove the temporary trigger before committing.

**[done 2026-08-28]** A temporary `errorProbe.tsx` ran 10 cases on both platforms and wrote its results to a JSON file on-device (reading the UI accessibility tree proved unreliable; `console.log` does not surface to `os_log`). Results: **Android 10/10, iOS 9/10**. The single iOS non-pass is `unlink('/missing')` throwing nothing, which is deliberate pre-existing behaviour (`ios/Fs2.swift:181-187`, "Original library didn't throw an error here, so we won't either") and unrelated to this fix — see the new finding at the bottom of this document. The probe was removed before committing.

Two gotchas for anyone repeating this:
- The probe button must be rendered **above the fold**. AppleScript `AXPress` on an off-screen element reports success and silently does nothing.
- The probe must report each case as it settles. Collecting results and rendering once at the end means a single hanging call hides every other result.

> **Do not** use the original plan's "compare the prefixes across platforms and confirm they match" as the gate. Against today's code that check fails on both sides, and after an iOS-only fix it would still fail — which would read as an iOS regression when it is the Android baseline that is wrong.

---

## Finding 2 — `nitro.json` uses the retired autolinking syntax

**[verified]** `npx nitrogen` warns on every run:
`Warning: nitro.json uses deprecated autolinking syntax ("cpp"/"swift"/"kotlin") for [Fs2, MediaStore, Fs2Stream].`

**[verified]** Schema in `node_modules/nitrogen/lib/config/NitroUserConfig.d.ts` accepts both; the legacy form is transformed into the new one, so this is warning-only today.

Replace each entry:

```json
"Fs2": {
  "ios":     { "language": "swift",  "implementationClassName": "Fs2" },
  "android": { "language": "kotlin", "implementationClassName": "Fs2" }
}
```

…and the same for `MediaStore` and `Fs2Stream`.

**[re-verified 2026-08-28]** I performed this migration and re-ran nitrogen. Result: the warning disappears, `Generated 3/3 HybridObjects`, and `diff -rq` against the pre-migration `nitrogen/` reports **byte-identical output**. Adding `$schema` at the same time was accepted without complaint.

**[correction 2026-08-28]** The original note said to "rebuild both platforms (the generated autolinking registration changes shape)". **The generated output does not change at all** — no rebuild is required. This is a pure warning fix.

**Verify:** `rm -rf nitrogen/ && npx nitrogen` → no warning, still `Generated 3/3 HybridObjects`, and `diff -rq` against a backup of the previous `nitrogen/` shows no differences.

---

## Finding 3 — `ArrayBuffer.copy(of:)` no longer throws

**[verified]** In 0.37 `copy(of:)` is non-throwing; only `copy(data:)` throws. The Swift compiler reports at three sites: *"no calls to throwing functions occur within 'try' expression"* and *"'catch' block is unreachable"*.

Sites **[re-verified 2026-08-28, line numbers corrected]**: `ios/Fs2.swift:75` (`writeFile`), `ios/Fs2.swift:438` (`appendFile`), `ios/Fs2Stream.swift:364` (`writeToStream`). (The original document said 74 / 437 / 363 — each was off by one.)

Confirmed against `node_modules/react-native-nitro-modules/ios/core/ArrayBuffer.swift`: `copy(of other: ArrayBuffer) -> ArrayBuffer` at line 97 is non-throwing; only `copy(data: Data) throws` at line 104 throws. Our two `copy(data:)` sites (`Fs2.swift:63`, `Fs2Stream.swift:236`) keep their `try` correctly and are **not** part of this finding.

Each is a `do { copiedBuffer = try ArrayBuffer.copy(of: data) } catch { return Promise.rejected(withError: error) }` — the rejection path is unreachable. Collapse to a plain assignment.

---

## Finding 4 — every buffer is copied unconditionally

**[verified]** Docs give the canonical pattern:

```swift
let copy = buffer.isOwner ? buffer : ArrayBuffer.copy(of: buffer)
```

**[correction 2026-08-28] Do not hand-roll this ternary — Nitro 0.37 ships the helper on both platforms.** Use `asOwning()`:

```swift
let copy = data.asOwning()   // ios/…: ArrayBuffer.swift:159
```
```kotlin
val copy = data.asOwning()   // android/…: ArrayBuffer.kt:138
```

Both are defined as exactly "return self if `isOwner`, else copy". This removes the whole class of `isOwner`-inversion mistakes the verification note below warns about, and it is a one-line change per site.

Rationale: buffers from JS are non-owning and unsafe past the synchronous call; buffers already owning need no copy. We copy every time on both platforms, so `writeFile` / `appendFile` / `writeToStream` do a full redundant copy whenever the buffer is already owning.

- Swift sites: the three in Finding 3.
- Kotlin sites: `Fs2.kt:180`, `Fs2.kt:215`, `Fs2.kt:250`, `Fs2Stream.kt:404`. **[verified]** `isOwner` exists on the Kotlin `ArrayBuffer` (`ArrayBuffer.kt:48`).

Fold this into Finding 3's edit for Swift.

~~**[unverified]** Confirm Kotlin's `ArrayBuffer.copy` overloads and ownership semantics before changing the Kotlin sites.~~ **[resolved 2026-08-28]** Confirmed against `ArrayBuffer.kt`: `isOwner` at line 48, `asOwning()` at line 138, and `companion object fun copy(other: ArrayBuffer)` at line 216 — non-throwing, and the ownership semantics do mirror Swift. The Kotlin `try/catch` around `ArrayBuffer.copy(data)` is not provably dead the way the Swift one is (Kotlin has no checked exceptions, and `copy` can throw from its `getBuffer` path), so leave those `catch` blocks in place; only the copy itself becomes `asOwning()`.

**Verify:** run example 5 (streams) and example 1 (`writeFile`/`readFile`) on both platforms. This is a correctness-sensitive change: getting `isOwner` wrong causes use-after-free, not a compile error.

---

## Finding 5 — smaller items

| Item | Where | Fix |
|---|---|---|
| `NitroModules.applicationContext!!` force-unwrap | `Fs2.kt:15`, `Fs2Stream.kt:73` | Docs say always null-check. Use `?: throw Error("No Context available!")`, matching `RNFSMediaStoreManager.kt:23` which is already correct |
| `options.jobId ?? 1` is dead | `ios/Downloader.swift:56` | `jobId: number` is required in the spec so it generates non-optional `Double`. Drop the `?? 1`. **[re-verified 2026-08-28]** Confirmed: `nitrogen/generated/ios/swift/DownloadFileOptions.swift:21` declares `jobId: Double`, non-optional |
| `nitro.json` missing `$schema` | `nitro.json` | Add `"$schema": "https://nitro.margelo.com/nitro.schema.json"` for editor validation |
| `ignorePaths` not a glob | `nitro.json` | Ours is `["node_modules"]`; docs use `["**/node_modules"]`. **[re-verified 2026-08-28 — upgrade from "harmless"]** Measured with probe `.nitro.ts` files: `["node_modules"]` excludes top-level but **fails to exclude `example/node_modules`** (nitrogen picked the probe up and generated 4/4). `["**/node_modules"]` excludes both. `nitrogen.js:29` builds the negation as `'!' + path.join(baseDirectory, ignorePath)`, so the literal form only ever matches one directory. Real latent bug in a repo that has `example/node_modules`; make the change |
| `memorySize` left at default `0` | all three HybridObjects | Docs: the JS GC cannot see native memory. For a file library holding large ArrayBuffers this under-reports pressure. A tuning decision, not an API error — raise it before implementing |

---

## Divergence from docs — deliberate, do not "fix" silently

**[verified]** Nitro docs say to commit `nitrogen/generated/` and *"ensure they're not excluded in `.npmignore` or `.gitignore`"*. Our `.gitignore` ignores `nitrogen/`, contradicting that.

**[verified] Publishing is unaffected**: `npm pack --dry-run` shows **174 `nitrogen/generated` files** in the tarball (247 total), because `prepare: bob build` regenerates them before packing, and `package.json` `files` includes `nitrogen`. **[re-verified 2026-08-28]** Re-ran it: 247 files, 174 under `nitrogen/generated`. Exact match.

The wake-up plan explicitly instructed *"Never commit it"*. Treat this as the maintainer's call: the cost is that generated API changes are invisible in code review and a consumer building from a git checkout must run nitrogen. **Raise it, do not change it unilaterally.**

---

## Verified correct — do not re-investigate

- **`Int64` everywhere, zero `UInt64`** in `src/nitro/` (15 occurrences). Docs confirm signed `bigint` → Swift `Int64` / Kotlin `Long`. Plain `bigint` is banned in 0.37; already removed.
- **Promise API current on both platforms.** Everything we call — `async`, `rejected`, `resolve`, `reject` — exists in 0.37.
- **No deprecated Nitro API is used.** The only two in the package (`FastVectorCopy`, `CachedProp`) are Nitro Views concerns; this library exposes only HybridObjects.
- **HybridObject bases correct**; `memorySize` and `dispose` have defaults, so not overriding them is valid.
- **`NitroModules.applicationContext` is the documented accessor** (HybridObjects deliberately do not take Context via constructor).
- **Kotlin `throw Error(...)` matches the documented pattern** — Finding 1 is iOS-only.
- **Minimum requirements exceeded:** compileSdk 37 (≥34), NDK 27.1.12297006 (≥27), peer react-native `>=0.82.0` (≥0.75), Swift 6.3.1 (≥5.9).
- **Kotlin build emits zero Nitro warnings.** The three that remain are pre-existing and unrelated: two `path`/`filepath` parameter-name mismatches (`Fs2.kt:145,176`) and a nullability warning (`RNFSManager.kt:208`).
- **`CC_MD5` deprecation** (`Fs2.swift:323`) is iOS-13-era and deliberate — MD5 is an offered hash algorithm, not a Nitro issue.

**[re-verified 2026-08-28]** Spot-checked and all still true, several to the exact number: 15 `Int64` and 0 `UInt64` in `src/nitro/` (12 in `Fs2Stream.nitro.ts`, 3 in `MediaStore.nitro.ts`); 0 uses of `FastVectorCopy`/`CachedProp`; 0 `memorySize` overrides; compileSdk 37, NDK 27.1.12297006, minSdk 24 (`android/gradle.properties`), peer `react-native >=0.82.0`, Swift 6.3.1; `CC_MD5` at `Fs2.swift:323`; the `path`/`filepath` mismatches at `Fs2.kt:145` and `:176` against `Fs2.nitro.ts:93,99`.

**One clarification to the Kotlin bullet:** "Kotlin `throw Error(...)` matches the documented pattern" is true as written, but see Finding 1 — matching the documented pattern still produces a mangled JS message, because the mangling happens in fbjni, below Nitro. Finding 1 is **not** iOS-only.

---

## Suggested order

**[revised 2026-08-28]**

1. **Decide Finding 1's Step 3 approach** (JS normaliser vs. native-both-sides) before writing code. This is now a design decision, not a mechanical fix, because the bug is cross-platform.
2. **Finding 1** — the only user-visible bug; fix and verify behaviourally on **both** platforms against the corrected gate.
3. **Findings 2 + 3 + 5's dead code + 5's `ignorePaths`** — mechanical, low risk. Finding 2 clears the build warning with no rebuild needed; `ignorePaths` is a one-word change with a confirmed latent failure behind it.
4. **Finding 4** — correctness-sensitive, but much less so now that `asOwning()` replaces the hand-rolled ternary. Still verify on device.
5. **Finding 5's `memorySize`** and the `nitrogen/` gitignore question — raise with the maintainer first.

**There is still no test harness** (`src/__tests__/index.test.tsx` is one `it.todo`). Running the example app on both platforms remains the only real gate. Compiling proves nothing.

---

## New finding surfaced during implementation — `unlink` diverges across platforms

**[verified 2026-08-28, behaviourally on both platforms]** `RNFS.unlink('/path/that/does/not/exist')`:

- **iOS** resolves successfully. `ios/Fs2.swift:181-187` returns early with the comment *"Original library didn't throw an error here, so we won't either."*
- **Android** rejects with `ENOENT: File does not exist: <path>`.

This is a genuine cross-platform inconsistency in the public 4.x API, but it is **behavioural, not a message-formatting bug**, so it is out of scope for Finding 1 and was deliberately left alone. Whichever way it is resolved is an API decision: match iOS (unlink of a missing file is a no-op, the Node `fs.rm({force:true})` shape) or match Android (throw, the Node `fs.unlink` shape). Raise with the maintainer.

---

## Verification log — 2026-08-28

Independent re-check of every claim in this document. Method, so the next reader knows what was and was not actually exercised.

**Read directly from source:** `react-native-nitro-modules` 0.37.0 (`RuntimeError.swift`, `Promise.swift`, `ArrayBuffer.swift`, `ArrayBuffer.kt`, `Promise.kt`, `JPromise.hpp`, `JSIConverter+Exception.hpp`, `JSIConverter+Promise.hpp`), `nitrogen` 0.37.0 (`NitroUserConfig.d.ts`, `nitrogen.js`), fbjni 0.7.0 (`Exceptions.h`, `Exceptions.cpp`, `ExceptionHelper.java` from the sources jar), and the generated `JHybridFs2Spec.cpp` / `HybridFs2Spec_cxx.swift`.

**Executed:**
- `swift` script reproducing `String(describing:)` for a `LocalizedError` enum, an `NSError`, and a `CustomStringConvertible` enum — reproduced Finding 1's table exactly.
- `npx nitrogen` before and after migrating `nitro.json` to the new autolinking syntax, with `diff -rq` on the output — byte-identical.
- Probe `.nitro.ts` files planted in `node_modules/` and `example/node_modules/` under three `ignorePaths` settings — established the nested-exclusion failure.
- `npm pack --dry-run --json` — 247 files, 174 generated.

**Not exercised:** nothing was built or run on a device or simulator. The Android mangling in Finding 1 is a source-verified code path, not an observed JS string. That observation is still owed, and Finding 1's Step 4 is where to collect it.

**Working tree:** restored. `nitrogen/` was backed up and diffed back to its baseline, `nitro.json` restored from backup, all probe files deleted. `git status` matches its pre-session state.
