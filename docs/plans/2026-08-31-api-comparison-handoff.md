# Handoff — API comparison pass and on-device verification

Branch `nitro-migration`, 26 commits on top of `73b542b`, plus the file-protection work
described below sitting uncommitted in the working tree. All gates green.

## What happened

Started as an adversarial review of `docs/API_COMPARISON.md` (written by an earlier session),
became a fix pass over everything the review found, then an on-device verification pass that
found four more defects nothing else could have caught.

The review found the document wrong in seven material ways — the load-bearing one being that
all four of its "breaking and silent" markers were actually compile errors, which collapsed its
central premise. It also missed the largest silent break in the migration (`downloadFile`'s
promise resolving a bare jobId). The document has since been rewritten and every claim in it is
now backed by a `file:line` citation that resolves.

Then we walked the document top to bottom, resolving each breaking item with the maintainer,
and finally ran the example app on both platforms.

## The pattern worth carrying forward

**Every phase found bugs the previous phase could not see.** Reading found type and contract
errors. Compiling found none. Running on a device found four:

| Found by | Defect |
|---|---|
| device run | `touch` on Android wrote timestamps 1000× too large |
| device run | a failed download **resolved** instead of rejecting, on **both** platforms |
| device run | the `complete` event races the native promise on iOS, so `statusCode` came back `undefined` |
| device run | `stat()` on a `content://` URI reported `mtime: 0` (1970) |
| device run | iOS MediaStore stubs threw synchronously, so Nitro prefixed the method name and broke `startsWith('ENOTSUP')` |

Three of those live in files the earlier review had listed as **unreviewed**. That list is
predictive, not decorative.

The file-protection pass since then adds a fifth kind: **writing the fix can introduce a worse
bug than the one being fixed.** Applying protection inside `moveFile`'s existing `do` block put
it in the scope of the copy-and-delete fallback, whose first act is to delete the destination.
A `setAttributes` failure would therefore have destroyed a file that had just moved
successfully. Nothing tests that path — the catch is only reachable on a cross-volume move.
Protection is now applied outside the block (`ios/Fs2.swift:422-426`), and `copyFile` had a
milder version of the same shape.

Second lesson, learned twice: **assert on this library's behaviour, not the peer's.** Two
checks originally asserted `statusCode === 200` and that `begin` fired. Both failed for reasons
outside the library — a rate-limiting host, then a chunked response with no `Content-Length`,
which legitimately suppresses `begin` (`ios/Downloader.swift:148`).

## Gates — there are four, not three

```bash
npx tsc --noEmit
npx jest                                                    # 53 tests
cd example/android && ./gradlew :react-native-fs2:compileDebugKotlin
cd example/ios && xcodebuild -project Pods/Pods.xcodeproj -target RNFS2 \
  -sdk iphonesimulator -configuration Debug -arch arm64 build
```

The fourth is easy to miss and covers a lot: most fixes this session were Swift, and nothing
else compiles it. Expect two pre-existing warnings — `CC_MD5` deprecation in `Fs2.swift`, an
unused `try?` at `Fs2Stream.swift:119`.

> **Never pass `clean` to that xcodebuild command.** It deletes
> `example/ios/build/generated/ios/ReactCodegen`, which is React Native codegen output the
> build does not regenerate. Recovering needs `pod install` in `example/ios`. This cost time
> today.

## On-device verification

`example/src/verify.ts` runs on app launch, exercises the real native layer, renders a
pass/fail list in the example app and writes a JSON report. Currently **iOS 21/0 (1 skip),
Android 22/0**.

```bash
cd example && npx react-native start &                       # Metro must be running

# iOS
xcrun simctl boot 526D88B7-9F5D-4807-B871-EB70DE73961A        # iPhone 17 Pro Max
cd example/ios && xcodebuild -workspace Fs2Example.xcworkspace -scheme Fs2Example \
  -configuration Debug -sdk iphonesimulator \
  -destination 'id=526D88B7-9F5D-4807-B871-EB70DE73961A' -derivedDataPath build/dd build
xcrun simctl install <udid> build/dd/Build/Products/Debug-iphonesimulator/Fs2Example.app
xcrun simctl launch <udid> fs2.example
cat "$(xcrun simctl get_app_container <udid> fs2.example data)/Documents/rnfs2-verify.json"

# Android
~/Library/Android/sdk/emulator/emulator -avd Pixel_9_Pro_XL &
adb reverse tcp:8081 tcp:8081
cd example/android && ./gradlew :app:installDebug
adb shell monkey -p fs2.example -c android.intent.category.LAUNCHER 1
adb exec-out run-as fs2.example cat files/rnfs2-verify.json
```

JS-only changes need only a relaunch; native changes need a rebuild. The Android report is
written progressively — poll until it parses as JSON, not until it exists.

The download check targets the **Metro dev server** (`http://localhost:8081/status`), not a
public URL: Metro is running whenever the app is, and it is reachable on both platforms
(localhost on the simulator, via `adb reverse` on the emulator).

## Decisions taken — do not re-litigate

- ~~`moveFile`/`copyFile`/`writeFile` keep losing iOS file protection; restore in 4.1.~~
  **Done** — restored on all three, key renamed `fileProtection` to match `MkdirOptions`. The
  README's pre-create-the-directory workaround is gone. See "File protection" below.
- `MkdirOptions` keys stay renamed; no back-compat aliases.
- iOS `copyFile`/`moveFile` **overwrite** an existing destination (parity with Android,
  `MIGRATION_CHECKLIST.md:19`).
- `unlink` rejects `ENOENT` on both platforms.
- Android `exists`/`unlink` resolving `content://` URIs is kept and documented as a fix.
- Wrong-platform calls reject `ENOTSUP` rather than resolving something plausible.
- Timestamps are **milliseconds**, converted in the JS wrapper; native still emits seconds.
- `PicturesDirectoryPath` is `''` on iOS, like every other inapplicable constant.
- `downloadFile`'s promise resolves `DownloadResult`, rebuilt in the **JS wrapper** from the
  `complete` event. The Nitro method still returns the jobId alone — that is the tracked design
  (`MIGRATION_CHECKLIST.md:40`); do not change the spec for this.
- From earlier sessions: `isFile`/`isDirectory` are accessor methods; `downloadFile(options,
  headers?)` keeps its two-parameter Nitro shape; `completeHandlerIOS` is deferred, so iOS
  background downloads are unusable in 4.0.

## File protection (restored)

`FileOptions` is back on `writeFile`, `moveFile` and `copyFile` with `NSFileProtectionKey`
renamed `fileProtection` and narrowed to the `FileProtectionType` union, matching the
`MkdirOptions` decision. Three notes worth keeping:

- **`writeFile` sets protection at creation, not after.** `Data.write(to:)` takes no attribute
  dictionary, so the protected path uses `createFile(atPath:contents:attributes:)` as 3.x did
  (`master:ios/RNFSManager.m:121`). Applying it afterwards would leave the contents briefly
  readable at the default class. Unprotected writes keep the original `write(to:)` path, which
  reports a far better error — hence two branches (`ios/Fs2.swift:104-123`).
- **Protection rides in `writeFile`'s encoding argument**, as it did in 3.x. It is not a fourth
  parameter; `parseOptions` splits the object (`src/index.ts:216-223`).
- **Only partly verifiable.** Nothing in the public API reads a protection class back, so
  `verify.ts` can only confirm the option is accepted and the file survives. Asserting the class
  was actually applied needs a native test target or a new `stat` field.

A TDD note for the next person: the first four `parseOptions` tests passed the moment they were
written, because that function already spreads the whole options object through — the gap was
the return *type*, which jest cannot see. Type-level gaps need `tsc` as the failing gate; jest
will happily green-light them.

## What is left

**Untested on device — in priority order**

1. **The streaming API.** The largest dark surface. `example5.tsx` drives it by hand;
   `readStream`, `writeStream`, `copyFileWithProgress`, `processFileInChunks` and the
   back-pressure/ordering fix from the earlier review have never run against real native. Given
   the hit rate above, expect this to find something. Extending `verify.ts` is the cheap path —
   it is a pure JS addition that runs on next launch.
2. `stopDownload` mid-flight, and the resumable / `canBeResumed` path. `stopDownload` matters
   because it is the fallback branch in the new `downloadFile` wrapper, so it is the
   least-exercised code written this session.
3. `content://` handling in `exists`/`unlink` — documented, never tested. Needs a real
   MediaStore URI; the MediaStore check in `verify.ts` now creates one you can reuse.
4. B9's iOS registry locking under Thread Sanitizer.

**Unreviewed code** — `Downloader.kt` / `Downloader.swift` internals, `cpp-adapter.cpp`,
`RNFSMediaStoreManager.kt` query internals. `RNFSManager.kt` is now partly reviewed (three
defects came out of it) but was never read systematically.

**Accepted, not bugs** — Android error messages carry a trailing newline iOS does not;
`JsVisibleError.kt` documents why it is unavoidable and `startsWith` is unaffected.

**Housekeeping** — `dev/` holds one untracked, un-ignored file (`RNFSMediaStoreManager.java`, a
reference copy of master's Java). It dirties every `git status`. Gitignore it or delete it.

## Working conventions

- **Commits are one line**: `type: description`. No parenthesised scope, no body. The existing
  git history has both — it is what the maintainer is correcting, not a template. (Dependabot's
  `build(deps):` commits are not ours.)
- **Never use the section-sign character** in output. Write "section 7" or a `file:line` link.
- **Planning docs live one level above the repo** — `../MIGRATION_CHECKLIST.md`, `../TASKS.md`,
  `../PLAN.md`, `../ios_native_analysis.md`, `../android_native_analysis.md`. Grep them before
  calling any divergence a defect; absence from all of them is itself evidence it was
  unintended. Their line numbers drift — verify, do not trust a cited line.
- **Deliver docs as markdown in `docs/plans/`**, never as a published artifact.
- `nitrogen/generated/**` is gitignored and derived. Regenerate with `npx nitrogen` after any
  `.nitro.ts` change; never hand-edit. A struct field added there changes generated
  constructors on **both** platforms — `getFSInfo` gaining two optional fields silently
  required a Swift change too.

## Verifying the comparison document

Every `file:line` in `docs/API_COMPARISON.md` resolves (105 citations, 0 bad). If you edit it,
re-run the checker — a script that extracts each citation, pulls that range from the working
tree or `git show master:`, and prints it. Round one of the review found 14 wrong line numbers
purely from eyeballing `sed` output, including one wrong citation inherited from the previous
author and repeated in my own first draft. Do not eyeball line numbers.

**Two hazards the first checker missed.** Five `src/index.ts` citations were wrong when the
file-protection work re-audited them:

- *Resolving is not the same as being right.* Three of the five landed on real, non-blank code —
  just the wrong code, because a "does this line exist and is it non-empty" check passes on any
  in-range line. Check the cited text against the claim, not merely that something is there.
- *Editing code invalidates citations elsewhere.* Adding an options parameter to `moveFile` and
  `copyFile` shifted everything below by 13 lines. Any change to a heavily-cited file means
  re-running the checker over the whole document, not just the rows you touched.
