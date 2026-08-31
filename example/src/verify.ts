/**
 * On-device verification for the 4.0 API-comparison fixes.
 *
 * The unit suite mocks the native layer, so it cannot catch anything that lives in Swift or
 * Kotlin - a wrong timestamp unit, a missing enum case, a stub that resolves instead of
 * throwing. This runs the real thing on a real device and writes a JSON report next to the
 * test files, which the host reads back with `simctl get_app_container` / `adb`.
 *
 * Every check names the commit it guards, so a failure points straight at what regressed.
 */
import { Platform } from 'react-native';
import RNFS, { MediaStore } from 'react-native-fs2';

export type Check = {
  name: string;
  guards: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
};

export type Report = {
  platform: string;
  osVersion: string | number;
  ranAt: string;
  passed: number;
  failed: number;
  skipped: number;
  checks: Check[];
};

const checks: Check[] = [];

function record(
  name: string,
  guards: string,
  status: Check['status'],
  detail: string
) {
  checks.push({ name, guards, status, detail });
}

async function check(name: string, guards: string, fn: () => Promise<string>) {
  try {
    record(name, guards, 'pass', await fn());
  } catch (e: any) {
    record(name, guards, 'fail', e?.message ?? String(e));
  }
}

async function skip(name: string, guards: string, why: string) {
  record(name, guards, 'skip', why);
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/**
 * The Metro dev server, not a public host. An external URL makes this check test someone
 * else's uptime - picsum rate-limited and then timed out across repeated runs - when what is
 * under test is our own promise/event plumbing. Metro is by definition running whenever this
 * app is, serves a tiny body on /status, and is reachable from both platforms: localhost on
 * the iOS simulator, and on Android through the `adb reverse tcp:8081 tcp:8081` the RN CLI
 * already sets up for the bundle.
 */
const DOWNLOAD_URL = 'http://localhost:8081/status';

/** Keeps a hung network call from stalling the whole run. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

/**
 * Rejects unless `fn` throws a message *starting* with `code`.
 *
 * `startsWith` rather than `includes` on purpose - it is the documented contract
 * (`err.message.startsWith('ENOENT')`), and only the strict form catches a message that has
 * been prefixed on its way to JS. Nitro prepends the method name to anything thrown
 * synchronously out of a `throws -> Promise<T>`, which is how the iOS MediaStore stubs used
 * to arrive as `MediaStore.mediaStoreQueryFile(...): ENOTSUP: ...`.
 */
async function expectRejection(fn: () => Promise<unknown>, code: string) {
  let message: string | undefined;
  try {
    await fn();
  } catch (e: any) {
    message = e?.message ?? String(e);
  }
  assert(message !== undefined, `expected a rejection, but it resolved`);
  assert(
    message!.startsWith(code),
    `expected the message to start with "${code}", got: ${message}`
  );
  return message!;
}

export async function runVerification(): Promise<Report> {
  checks.length = 0;

  const root = `${RNFS.DocumentDirectoryPath}/rnfs2-verify`;
  try {
    await RNFS.unlink(root);
  } catch {
    // Fresh install, or the previous run already cleaned up.
  }
  await RNFS.mkdir(root);

  // --- timestamps are milliseconds, not seconds ---------------------------------------
  // Guards: "fix: return stat and readDir timestamps in milliseconds". Native emits whole
  // seconds on both platforms; the wrapper multiplies. Without it every timestamp lands in
  // January 1970, which is exactly what the old README example produced.
  await check('stat() mtime is milliseconds', 'timestamps-in-ms', async () => {
    const file = `${root}/stamp.txt`;
    const before = Date.now();
    await RNFS.writeFile(file, 'x', 'utf8');
    const { mtime } = await RNFS.stat(file);
    const skewMinutes = Math.abs(mtime - before) / 60000;

    assert(
      skewMinutes < 5,
      `mtime ${mtime} is ${skewMinutes.toFixed(1)} min from now (${before}). ` +
        `A value near ${Math.floor(before / 1000)} means seconds leaked through.`
    );
    assert(
      new Date(mtime).getUTCFullYear() >= 2020,
      `new Date(mtime) gave ${new Date(mtime).toISOString()}`
    );
    // iOS reports sub-second precision, so the raw seconds-to-ms product is fractional there
    // while Android is always whole. The wrapper rounds so both platforms agree.
    assert(
      Number.isInteger(mtime),
      `mtime ${mtime} is fractional; it should be a whole number of milliseconds`
    );
    return `mtime=${mtime}, ${new Date(mtime).toISOString()}`;
  });

  await check(
    'readDir() mtime is milliseconds',
    'timestamps-in-ms',
    async () => {
      const items = await RNFS.readDir(root);
      const entry = items.find((i) => i.name === 'stamp.txt');
      assert(!!entry, 'stamp.txt missing from readDir');
      const skewMinutes = Math.abs(entry!.mtime - Date.now()) / 60000;
      assert(
        skewMinutes < 5,
        `mtime ${entry!.mtime} is ${skewMinutes} min off`
      );
      return `mtime=${entry!.mtime}`;
    }
  );

  // --- touch round-trips through stat ---------------------------------------------------
  // Guards: "fix: stop multiplying the touch mtime by 1000 on Android". The Kotlin multiplied
  // an already-millisecond value by 1000, putting files ~30,000 years out. Only a real
  // filesystem shows this - the JS suite mocks the call.
  await check('touch() round-trips through stat()', 'touch-x1000', async () => {
    const file = `${root}/touched.txt`;
    await RNFS.writeFile(file, 'x', 'utf8');

    const target = new Date('2021-06-01T12:00:00.000Z');
    await RNFS.touch(file, target);
    const { mtime } = await RNFS.stat(file);

    const skewHours = Math.abs(mtime - target.getTime()) / 3600000;
    assert(
      skewHours < 24,
      `set ${target.toISOString()}, read back ${new Date(mtime).toISOString()} ` +
        `(${mtime}). A far-future value means the x1000 bug is back.`
    );
    return `set ${target.toISOString()}, read ${new Date(mtime).toISOString()}`;
  });

  // --- sha224 is reachable again --------------------------------------------------------
  // Guards: "fix: restore sha224 ...". Digests are of the literal string "abc", so a wrong
  // algorithm or a truncated digest is obvious rather than merely "different".
  const KNOWN = {
    md5: '900150983cd24fb0d6963f7d28e17f72',
    sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    sha224: '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7',
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  } as const;

  for (const algorithm of ['md5', 'sha1', 'sha224', 'sha256'] as const) {
    await check(`hash() supports ${algorithm}`, 'sha224-restored', async () => {
      const file = `${root}/abc.txt`;
      await RNFS.writeFile(file, 'abc', 'utf8');
      const digest = await RNFS.hash(file, algorithm);
      assert(
        digest.toLowerCase() === KNOWN[algorithm],
        `expected ${KNOWN[algorithm]}, got ${digest}`
      );
      return digest;
    });
  }

  // --- unlink rejects ENOENT on both platforms ------------------------------------------
  // Guards: "fix: reject ENOENT from unlink on iOS when the path is missing". iOS used to
  // resolve, so the platforms disagreed on the same call.
  await check(
    'unlink() on a missing path rejects ENOENT',
    'unlink-enoent',
    () =>
      expectRejection(() => RNFS.unlink(`${root}/does-not-exist.txt`), 'ENOENT')
  );

  // --- getFSInfo external space ---------------------------------------------------------
  // Guards: "fix: report external storage space from getFSInfo on Android". 3.x resolved
  // these on Android without declaring them; 4.x briefly computed and discarded them.
  await check('getFSInfo() shape', 'getfsinfo-external', async () => {
    const info: any = await RNFS.getFSInfo();
    assert(info.totalSpace > 0, `totalSpace was ${info.totalSpace}`);
    assert(info.freeSpace > 0, `freeSpace was ${info.freeSpace}`);

    if (Platform.OS === 'android') {
      assert(
        info.totalSpaceEx !== undefined,
        'totalSpaceEx is undefined on Android; the external pair was dropped again'
      );
      return `total=${info.totalSpace} free=${info.freeSpace} totalEx=${info.totalSpaceEx} freeEx=${info.freeSpaceEx}`;
    }

    assert(
      info.totalSpaceEx === undefined,
      `totalSpaceEx should be undefined on iOS, got ${info.totalSpaceEx}`
    );
    return `total=${info.totalSpace} free=${info.freeSpace}, no external pair (correct on iOS)`;
  });

  // --- wrong-platform methods reject ENOTSUP --------------------------------------------
  // Guards: "fix: reject ENOTSUP from platform-specific methods on the wrong platform".
  // These used to resolve [] / false / nothing, which reads as a real answer.
  if (Platform.OS === 'ios') {
    await check('scanFile() rejects ENOTSUP on iOS', 'enotsup-stubs', () =>
      expectRejection(() => RNFS.scanFile('/tmp/x'), 'ENOTSUP')
    );
    await check(
      'getAllExternalFilesDirs() rejects ENOTSUP on iOS',
      'enotsup-stubs',
      () => expectRejection(() => RNFS.getAllExternalFilesDirs(), 'ENOTSUP')
    );
    await skip(
      'resumeDownload()/isResumable() reject ENOTSUP',
      'enotsup-stubs',
      'Android-only check; these are supported on iOS'
    );
  } else {
    await check(
      'isResumable() rejects ENOTSUP on Android',
      'enotsup-stubs',
      () => expectRejection(() => RNFS.isResumable(1), 'ENOTSUP')
    );
    await check(
      'resumeDownload() rejects ENOTSUP on Android',
      'enotsup-stubs',
      () => expectRejection(() => RNFS.resumeDownload(1), 'ENOTSUP')
    );
    await check(
      'getAllExternalFilesDirs() resolves on Android',
      'enotsup-stubs',
      async () => {
        const dirs = await RNFS.getAllExternalFilesDirs();
        assert(Array.isArray(dirs), `expected an array, got ${typeof dirs}`);
        return `${dirs.length} dir(s): ${dirs.join(', ')}`;
      }
    );
  }

  // --- PicturesDirectoryPath ------------------------------------------------------------
  // Guards: "fix: return an empty PicturesDirectoryPath on iOS". It briefly returned a truthy
  // path to a sandbox directory that does not exist, so falsy guards started passing.
  await check('PicturesDirectoryPath', 'pictures-path', async () => {
    const value = RNFS.PicturesDirectoryPath;
    if (Platform.OS === 'ios') {
      assert(
        value === '',
        `expected '' on iOS, got ${JSON.stringify(value)} - truthy but unusable`
      );
      return `'' (correct on iOS)`;
    }
    assert(!!value, 'expected a real path on Android');
    return value;
  });

  // --- copyFile overwrites an existing destination --------------------------------------
  // Guards: documented in the README breaking changes. 3.x iOS rejected here while Android
  // overwrote; both overwrite now, which is silent and destructive.
  await check(
    'copyFile() overwrites an existing destination',
    'copy-overwrite',
    async () => {
      const src = `${root}/src.txt`;
      const dest = `${root}/dest.txt`;
      await RNFS.writeFile(src, 'new', 'utf8');
      await RNFS.writeFile(dest, 'old', 'utf8');
      await RNFS.copyFile(src, dest);
      const contents = await RNFS.readFile(dest, 'utf8');
      assert(
        contents === 'new',
        `expected 'new', got ${JSON.stringify(contents)}`
      );
      return `destination replaced, as documented`;
    }
  );

  // --- mkdir accepts excludedFromBackup: false ------------------------------------------
  // Guards: "fix: honour excludedFromBackup false in mkdir on iOS". Reading the flag back
  // needs NSURL resource values, which are not exposed here - this only proves the call is
  // accepted and does not throw.
  await check(
    'mkdir() accepts excludedFromBackup in both states',
    'mkdir-backup-flag',
    async () => {
      await RNFS.mkdir(`${root}/excluded`, { excludedFromBackup: true });
      await RNFS.mkdir(`${root}/included`, { excludedFromBackup: false });
      assert(await RNFS.exists(`${root}/excluded`), 'excluded dir missing');
      assert(await RNFS.exists(`${root}/included`), 'included dir missing');
      return 'both accepted (flag value itself is not readable from JS)';
    }
  );

  // --- round trip through every encoding ------------------------------------------------
  await check(
    'readFile/writeFile round-trip',
    'encoding-round-trip',
    async () => {
      const file = `${root}/round.txt`;
      const text = 'héllo wörld ✅';
      await RNFS.writeFile(file, text, 'utf8');
      const back = await RNFS.readFile(file, 'utf8');
      assert(
        back === text,
        `expected ${JSON.stringify(text)}, got ${JSON.stringify(back)}`
      );

      const buffer = await RNFS.readFile(file, 'arraybuffer');
      assert(
        buffer instanceof ArrayBuffer,
        `arraybuffer encoding returned ${typeof buffer}`
      );
      return `utf8 round-tripped, arraybuffer gave ${(buffer as ArrayBuffer).byteLength} bytes`;
    }
  );

  // --- downloadFile resolves DownloadResult, not a bare jobId ---------------------------
  // Guards: "fix: resolve DownloadResult from downloadFile instead of a bare jobId". The
  // Nitro method resolves the jobId alone and sends status/bytes over the complete event; the
  // wrapper reassembles the 3.x shape. Typed `Promise<any>` before, so the regression compiled
  // and ran silently - only awaiting a real download shows it.
  await check(
    'downloadFile() resolves DownloadResult',
    'download-result',
    async () => {
      const dest = `${root}/downloaded.jpg`;
      const seen = { begin: false, progress: false, complete: false };

      const { jobId, promise } = RNFS.downloadFile({
        fromUrl: DOWNLOAD_URL,
        toFile: dest,
        begin: () => {
          seen.begin = true;
        },
        progress: () => {
          seen.progress = true;
        },
        complete: () => {
          seen.complete = true;
        },
      });

      const result: any = await withTimeout(promise, 45000, 'download');

      assert(
        typeof result === 'object' && result !== null,
        `resolved ${typeof result} (${result}) instead of an object - ` +
          `this is the bare-jobId regression`
      );
      assert(
        result.jobId === jobId,
        `resolved jobId ${result.jobId}, expected ${jobId}`
      );
      // Assert the field is *populated*, not that it equals 200 - the remote host's mood is
      // not under test. `undefined` here is the regression: it means the wrapper never saw
      // the complete event and fell back to the bare jobId.
      assert(
        typeof result.statusCode === 'number',
        `statusCode was ${result.statusCode}; the complete event was not captured`
      );
      assert(
        typeof result.bytesWritten === 'number' && result.bytesWritten > 0,
        `bytesWritten was ${result.bytesWritten}`
      );
      assert(seen.complete, 'the complete callback never fired');
      // `begin` and `progress` are deliberately NOT asserted. Both fire only once the
      // transfer size is known - iOS gates them on `totalBytesExpectedToWrite > 0`
      // (ios/Downloader.swift:148) - so a chunked response with no Content-Length, which is
      // what Metro sends, legitimately produces neither. Asserting them would test the
      // server's framing rather than this library. They are reported below instead.

      const stat = await RNFS.stat(dest);
      assert(
        stat.size === result.bytesWritten,
        `file is ${stat.size} bytes but bytesWritten said ${result.bytesWritten}`
      );

      return (
        `jobId=${result.jobId} statusCode=${result.statusCode}` +
        `${result.statusCode === 200 ? '' : ' (remote host said so, not our code)'} ` +
        `bytesWritten=${result.bytesWritten} onDisk=${stat.size} ` +
        `callbacks(begin/progress/complete)=${seen.begin}/${seen.progress}/${seen.complete}`
      );
    }
  );

  // A failed download must reject the promise and fire the error callback, rather than
  // resolving a result object with empty fields.
  await check(
    'downloadFile() rejects on a bad host',
    'download-error',
    async () => {
      let errorEventFired = false;
      const { promise } = RNFS.downloadFile({
        fromUrl: 'https://this-host-does-not-exist.invalid/a.bin',
        toFile: `${root}/never.bin`,
        error: () => {
          errorEventFired = true;
        },
      });

      let rejected = false;
      try {
        await withTimeout(promise, 45000, 'failing download');
      } catch {
        rejected = true;
      }
      assert(rejected, 'the promise resolved for an unreachable host');
      return `rejected as expected (error callback fired: ${errorEventFired})`;
    }
  );

  // --- Android MediaStore -----------------------------------------------------------------
  // The whole namespace was untested until now. The stat check below is the one that matters:
  // `statContentUri` only looked for DocumentsContract's "last_modified" column, which
  // MediaStore does not have, so every content:// stat reported mtime 0 (1970).
  if (Platform.OS === 'android') {
    await check(
      'MediaStore copy, query, stat and delete',
      'mediastore-android',
      async () => {
        const source = `${root}/media-source.png`;
        // A 1x1 PNG, so the entry is a genuinely decodable image rather than stray bytes.
        const PNG_1PX_BASE64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        await RNFS.writeFile(source, PNG_1PX_BASE64, 'base64');

        const fileName = `rnfs2-verify-${Date.now()}.png`;
        const uri = await MediaStore.copyToMediaStore(
          {
            name: fileName,
            parentFolder: 'RNFS2Verify',
            mimeType: 'image/png',
          },
          MediaStore.MEDIA_IMAGE,
          source
        );
        assert(
          typeof uri === 'string' && uri.startsWith('content://'),
          `copyToMediaStore returned ${uri}`
        );

        const found = await MediaStore.queryMediaStore({
          fileName,
          relativePath: 'RNFS2Verify',
          mediaType: MediaStore.MEDIA_IMAGE,
        });
        assert(
          found !== undefined,
          'queryMediaStore did not find the entry it just created'
        );
        assert(
          found!.uri === uri,
          `query returned ${found!.uri}, created ${uri}`
        );

        // The bug this guards: a content:// stat with mtime 0.
        const stat = await RNFS.stat(uri);
        assert(stat.size > 0, `stat reported size ${stat.size}`);
        assert(
          stat.mtime > 0,
          `stat reported mtime ${stat.mtime}; MediaStore exposes date_modified, not ` +
            `DocumentsContract's last_modified, so reading only the latter yields 0`
        );
        const skewDays = Math.abs(stat.mtime - Date.now()) / 86400000;
        assert(
          skewDays < 2,
          `mtime ${new Date(stat.mtime).toISOString()} is ${skewDays.toFixed(1)} days off`
        );

        const deleted = await MediaStore.deleteFromMediaStore(uri);
        assert(deleted, 'deleteFromMediaStore returned false');

        const afterDelete = await MediaStore.queryMediaStore({
          fileName,
          relativePath: 'RNFS2Verify',
          mediaType: MediaStore.MEDIA_IMAGE,
        });
        assert(
          afterDelete === undefined,
          'query still found the entry after it was deleted'
        );

        return (
          `uri=${uri} size=${stat.size} ` +
          `mtime=${new Date(stat.mtime).toISOString()} ctime=${new Date(stat.ctime).toISOString()}`
        );
      }
    );
  } else {
    await check('MediaStore rejects ENOTSUP on iOS', 'mediastore-android', () =>
      expectRejection(
        () => MediaStore.queryMediaStore({ mediaType: 'Image' }),
        'ENOTSUP'
      )
    );
  }

  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const skipped = checks.filter((c) => c.status === 'skip').length;

  const report: Report = {
    platform: Platform.OS,
    osVersion: Platform.Version,
    ranAt: new Date().toISOString(),
    passed,
    failed,
    skipped,
    checks,
  };

  // Written with RNFS itself, which makes the write path part of the test. The host reads it
  // back with `simctl get_app_container` on iOS and `adb exec-out run-as` on Android.
  await RNFS.writeFile(
    `${RNFS.DocumentDirectoryPath}/rnfs2-verify.json`,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log(`RNFS2_VERIFY_BEGIN${JSON.stringify(report)}RNFS2_VERIFY_END`);
  return report;
}
