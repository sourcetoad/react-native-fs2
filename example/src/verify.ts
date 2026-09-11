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
import RNFS, {
  MediaStore,
  copyFileWithProgress,
  createReadStream,
  createWriteStream,
  listenToReadStreamData,
  listenToReadStreamEnd,
  listenToReadStreamError,
  listenToReadStreamProgress,
  listenToWriteStreamProgress,
  processFileInChunks,
  readStream,
  stringToArrayBuffer,
  writeStream,
} from 'react-native-fs2';

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

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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

  // iOS file protection, restored on writeFile/moveFile/copyFile. Nothing in the public API
  // reads a protection class back, so these cannot assert that the class was actually applied -
  // what they do cover is that the option reaches native, is accepted, and leaves a readable
  // file behind. Every native defect found on this branch so far was of exactly that kind.
  await check(
    'writeFile() accepts fileProtection and still writes',
    'file-protection',
    async () => {
      const file = `${root}/protected-write.txt`;
      await RNFS.writeFile(file, 'guarded', {
        encoding: 'utf8',
        fileProtection: 'NSFileProtectionComplete',
      });

      const back = await RNFS.readFile(file, 'utf8');
      assert(back === 'guarded', `read back ${JSON.stringify(back)}`);
      return `wrote and re-read ${(await RNFS.stat(file)).size} bytes`;
    }
  );

  await check(
    'copyFile() accepts fileProtection and still copies',
    'file-protection',
    async () => {
      const from = `${root}/protect-copy-src.txt`;
      const to = `${root}/protect-copy-dst.txt`;
      await RNFS.writeFile(from, 'copy me', 'utf8');
      await RNFS.copyFile(from, to, {
        fileProtection: 'NSFileProtectionCompleteUntilFirstUserAuthentication',
      });

      assert(await RNFS.exists(from), 'source disappeared after copyFile');
      const back = await RNFS.readFile(to, 'utf8');
      assert(back === 'copy me', `read back ${JSON.stringify(back)}`);
      return 'copied with protection, both paths intact';
    }
  );

  await check(
    'moveFile() accepts fileProtection and still moves',
    'file-protection',
    async () => {
      const from = `${root}/protect-move-src.txt`;
      const to = `${root}/protect-move-dst.txt`;
      await RNFS.writeFile(from, 'move me', 'utf8');
      await RNFS.moveFile(from, to, {
        fileProtection: 'NSFileProtectionComplete',
      });

      assert(!(await RNFS.exists(from)), 'source survived moveFile');
      const back = await RNFS.readFile(to, 'utf8');
      assert(back === 'move me', `read back ${JSON.stringify(back)}`);
      return 'moved with protection, source gone';
    }
  );

  // The streaming API. Until now it had never run against real native on either platform -
  // `example5.tsx` drives it by hand and the unit suite substitutes a fake native layer, so
  // ordering, back-pressure and chunk-boundary decoding were all unverified end to end.
  //
  // Every check below uses a file several times the buffer size, because a single-chunk file
  // exercises none of the interesting behaviour.
  const STREAM_CHUNK = 8 * 1024;

  // `readFile` is typed `string | ArrayBuffer`; every streaming check wants the text form.
  const readText = async (path: string): Promise<string> => {
    const contents = await RNFS.readFile(path, 'utf8');
    assert(typeof contents === 'string', `readFile gave ${typeof contents}`);
    return contents as string;
  };

  // Deliberately not a repeating byte: a stream that duplicated, dropped or reordered a chunk
  // would still round-trip a uniform payload. Each line carries its own index.
  const makeStreamPayload = (lines: number) =>
    Array.from({ length: lines }, (_, i) => `line ${i} ${'x'.repeat(64)}`).join(
      '\n'
    );

  await check(
    'readStream() round-trips a multi-chunk file',
    'streaming',
    async () => {
      const file = `${root}/stream-read.txt`;
      const payload = makeStreamPayload(600);
      await RNFS.writeFile(file, payload, 'utf8');
      const size = (await RNFS.stat(file)).size;

      const back = await readStream(file, 'utf8', {
        bufferSize: STREAM_CHUNK,
      });

      assert(typeof back === 'string', `got ${typeof back}, expected string`);
      assert(
        back === payload,
        `round-trip differs: ${(back as string).length} chars back vs ${payload.length} sent`
      );
      return `${size} bytes over ~${Math.ceil(size / STREAM_CHUNK)} chunks`;
    }
  );

  // The wrapper assembles every chunk before decoding once, precisely so a multi-byte
  // character split across a chunk boundary survives. Decoding per chunk corrupts it.
  await check(
    'readStream() decodes utf8 across a chunk boundary',
    'streaming',
    async () => {
      const file = `${root}/stream-utf8.txt`;
      // 'é' is two bytes, so an odd-length ASCII run before it lands the pair astride the
      // boundary for one of these sizes.
      const payload = `${'a'.repeat(STREAM_CHUNK - 1)}é${'b'.repeat(STREAM_CHUNK)}`;
      await RNFS.writeFile(file, payload, 'utf8');

      const back = await readStream(file, 'utf8', {
        bufferSize: STREAM_CHUNK,
      });

      assert(back === payload, 'multi-byte character did not survive');
      assert(
        !(back as string).includes('�'),
        'contains U+FFFD - a chunk was decoded in isolation'
      );
      return 'two-byte character intact across the boundary';
    }
  );

  await check(
    'writeStream() round-trips through readFile()',
    'streaming',
    async () => {
      const file = `${root}/stream-write.txt`;
      const payload = makeStreamPayload(400);

      await writeStream(file, payload, 'utf8');

      const back = await readText(file);
      assert(
        back === payload,
        `read back ${back.length} chars, wrote ${payload.length}`
      );
      return `${(await RNFS.stat(file)).size} bytes`;
    }
  );

  // The one that matters most: native does not await the data callback, so without the
  // serialised write chain the destination can be assembled out of order.
  await check(
    'copyFileWithProgress() copies byte-for-byte',
    'streaming',
    async () => {
      const from = `${root}/stream-copy-src.txt`;
      const to = `${root}/stream-copy-dst.txt`;
      const payload = makeStreamPayload(2000);
      await RNFS.writeFile(from, payload, 'utf8');

      const progressValues: number[] = [];
      await copyFileWithProgress(from, to, {
        bufferSize: STREAM_CHUNK,
        onProgress: (p) => progressValues.push(p),
      });

      const back = await readText(to);
      assert(
        back === payload,
        `copy differs: ${back.length} chars vs ${payload.length}. ` +
          `First divergence at index ${[...payload].findIndex((c, i) => back[i] !== c)}`
      );
      assert(progressValues.length > 0, 'no progress events fired');
      assert(
        progressValues[progressValues.length - 1]! > 0.99,
        `final progress was ${progressValues[progressValues.length - 1]}`
      );
      return `${payload.length} chars, ${progressValues.length} progress events`;
    }
  );

  await check(
    'processFileInChunks() delivers every chunk in order',
    'streaming',
    async () => {
      const file = `${root}/stream-chunks.txt`;
      const payload = makeStreamPayload(1200);
      await RNFS.writeFile(file, payload, 'utf8');
      const size = (await RNFS.stat(file)).size;

      const indices: number[] = [];
      const positions: number[] = [];
      let bytes = 0;

      await processFileInChunks(
        file,
        async (chunk, index, position) => {
          indices.push(index);
          positions.push(position);
          bytes += chunk.byteLength;
        },
        { bufferSize: STREAM_CHUNK }
      );

      assert(
        indices.length > 1,
        `only ${indices.length} chunk(s); expected several`
      );
      assert(
        indices.every((v, i) => v === i),
        `chunk indices out of order: ${indices.slice(0, 10).join(',')}`
      );
      assert(
        positions.every(
          (v, i) => v === (i === 0 ? 0 : positions[i - 1]! + STREAM_CHUNK)
        ),
        'positions are not contiguous'
      );
      assert(bytes === size, `saw ${bytes} bytes, file is ${size}`);
      return `${indices.length} chunks, ${bytes} bytes, all in order`;
    }
  );

  await check('readStream() handles an empty file', 'streaming', async () => {
    const file = `${root}/stream-empty.txt`;
    await RNFS.writeFile(file, '', 'utf8');

    const back = await readStream(file, 'utf8', { bufferSize: STREAM_CHUNK });

    assert(back === '', `expected empty string, got ${JSON.stringify(back)}`);
    return 'resolved empty rather than hanging';
  });

  // --- Streaming, round two -----------------------------------------------------------------
  // The first pass covered the happy paths of the four high-level helpers. These cover the
  // low-level handle API underneath them: range reads, pause/resume, append, position, and
  // what happens when the file is not there.

  await check(
    'createReadStream() honours start and end',
    'streaming-range',
    async () => {
      const file = `${root}/stream-range.txt`;
      // Index-bearing content, so a wrong offset is visible rather than plausible.
      const payload = Array.from({ length: 256 }, (_, i) =>
        String(i % 10)
      ).join('');
      await RNFS.writeFile(file, payload, 'utf8');

      const stream = await createReadStream(file, { start: 10, end: 19 });
      const parts: ArrayBuffer[] = [];
      const done = new Promise<void>((resolve) => {
        listenToReadStreamData(stream.streamId, (e) => {
          parts.push(e.data);
        });
        listenToReadStreamEnd(stream.streamId, () => resolve());
      });
      await stream.start();
      await withTimeout(done, 10000, 'range read');

      const total = parts.reduce((n, p) => n + p.byteLength, 0);
      const text = String.fromCharCode(
        ...new Uint8Array(
          parts.reduce<number[]>(
            (acc, p) => acc.concat(Array.from(new Uint8Array(p))),
            []
          )
        )
      );
      // `end` is inclusive on both platforms, so 10..19 is ten bytes.
      assert(
        total === 10,
        `read ${total} bytes, expected 10 for start:10 end:19`
      );
      assert(
        text === payload.slice(10, 20),
        `got ${JSON.stringify(text)}, expected ${JSON.stringify(payload.slice(10, 20))}`
      );
      return `start:10 end:19 gave exactly ${JSON.stringify(text)}`;
    }
  );

  // The one aimed at a real suspicion. iOS `pauseReadStream` finishes the old AsyncStream
  // continuation and installs a new one, so the read loop can capture a stream that is already
  // finished - `for await` over which returns immediately, making pause a no-op. If that
  // happens the stream runs to completion instead of holding, which is what this detects.
  //
  // Records a skip rather than a pass when the file drains before pause lands: a stream that
  // has already ended is stable for the same reason a paused one is, and calling that a pass
  // would be a false green.
  {
    const name = 'pause() actually halts the read loop';
    const guards = 'streaming-pause';
    try {
      const file = `${root}/stream-pause.txt`;
      // Many small chunks, so the reader has plenty left to do when the pause lands.
      const payload = 'p'.repeat(4 * 1024 * 1024);
      await RNFS.writeFile(file, payload, 'utf8');
      const totalChunks = Math.ceil(payload.length / 1024);

      const stream = await createReadStream(file, { bufferSize: 1024 });
      let chunks = 0;
      let ended = false;
      let pausePromise: Promise<void> | null = null;
      // Distinguishes "the reader outran the pause" from "JS never got a turn until the read
      // had already finished" - the latter would mean back-pressure cannot work at all here.
      let chunksAtPauseCall = 0;
      let chunksAtPauseResolved = 0;

      listenToReadStreamData(stream.streamId, () => {
        chunks += 1;
        if (chunks === 1 && !pausePromise) {
          chunksAtPauseCall = chunks;
          pausePromise = stream.pause();
        }
      });
      listenToReadStreamEnd(stream.streamId, () => {
        ended = true;
      });

      await stream.start();
      // Wait for the first chunk to trigger the pause call.
      for (let i = 0; i < 100 && !pausePromise; i++) await delay(10);
      if (pausePromise) await pausePromise;
      chunksAtPauseResolved = chunks;

      await delay(300);
      const settled = chunks;
      await delay(400);

      if (ended) {
        record(
          name,
          guards,
          'skip',
          `stream reached the end (${chunks}/${totalChunks} chunks) before pause could be ` +
            `observed. pause() was called at chunk ${chunksAtPauseCall} and resolved at ` +
            `chunk ${chunksAtPauseResolved}. If those are 1 and ${totalChunks}, JS never got ` +
            `a turn until the read had finished, and back-pressure cannot engage here at all`
        );
      } else {
        assert(
          chunks === settled,
          `chunk count moved from ${settled} to ${chunks} while paused`
        );
        const beforeResume = chunks;
        await stream.resume();
        const finished = new Promise<void>((resolve) => {
          listenToReadStreamEnd(stream.streamId, () => resolve());
        });
        await withTimeout(finished, 30000, 'resume');
        assert(
          chunks > beforeResume,
          `resume() produced no further chunks (still ${chunks})`
        );
        record(
          name,
          guards,
          'pass',
          `pause() called at chunk ${chunksAtPauseCall}, resolved at ` +
            `${chunksAtPauseResolved}; held at ${settled}/${totalChunks} while paused, ` +
            `ran on to ${chunks} after resume`
        );
      }
    } catch (e: any) {
      record(name, guards, 'fail', e?.message ?? String(e));
    }
  }

  // The read loop awaits whatever the data callback returns, which is the read path's
  // back-pressure. Nothing else here exercises it - `pause()` above is a separate mechanism.
  {
    const name = 'an async data listener holds the read loop';
    const guards = 'streaming-backpressure';
    try {
      const file = `${root}/stream-backpressure.txt`;
      const payload = 'b'.repeat(1024 * 1024);
      await RNFS.writeFile(file, payload, 'utf8');
      const totalChunks = Math.ceil(payload.length / 1024);

      const stream = await createReadStream(file, { bufferSize: 1024 });
      let chunks = 0;
      let ended = false;
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      listenToReadStreamData(stream.streamId, async () => {
        chunks += 1;
        // Hold on the first chunk only; every later one returns immediately.
        if (chunks === 1) await held;
      });
      listenToReadStreamEnd(stream.streamId, () => {
        ended = true;
      });

      const started = stream.start();
      await delay(600);
      const whileHeld = chunks;

      if (ended) {
        record(
          name,
          guards,
          'fail',
          `stream reached the end (${chunks}/${totalChunks} chunks) while the first chunk's ` +
            'listener had not resolved - the read loop is not awaiting the data callback'
        );
        release();
      } else {
        assert(
          whileHeld <= 2,
          `read ran on to ${whileHeld}/${totalChunks} chunks while the listener was held`
        );
        release();
        const finished = new Promise<void>((resolve) => {
          listenToReadStreamEnd(stream.streamId, () => resolve());
        });
        await withTimeout(started, 30000, 'start');
        await withTimeout(finished, 30000, 'drain after release');
        assert(
          chunks === totalChunks,
          `expected ${totalChunks} chunks after release, got ${chunks}`
        );
        record(
          name,
          guards,
          'pass',
          `held at ${whileHeld}/${totalChunks} chunks, drained to ${chunks} once released`
        );
      }
    } catch (e: any) {
      record(name, guards, 'fail', e?.message ?? String(e));
    }
  }

  await check(
    'a throwing data listener fails the read stream',
    'streaming-backpressure',
    async () => {
      const file = `${root}/stream-listener-throw.txt`;
      await RNFS.writeFile(file, 'x'.repeat(8192), 'utf8');

      const stream = await createReadStream(file, { bufferSize: 1024 });
      let errorMessage: string | null = null;
      const settled = new Promise<void>((resolve) => {
        listenToReadStreamData(stream.streamId, () => {
          throw new Error('listener exploded');
        });
        listenToReadStreamError(stream.streamId, (e) => {
          errorMessage = e.error;
          resolve();
        });
        listenToReadStreamEnd(stream.streamId, () => resolve());
      });

      await stream.start().catch(() => {});
      await withTimeout(settled, 10000, 'listener throw');
      await stream.close().catch(() => {});

      assert(
        errorMessage !== null,
        'a data listener that throws produced no read-stream error event'
      );
      return `surfaced as a read-stream error: ${errorMessage}`;
    }
  );

  // `bufferSize` bounds the write queue, and `write()` resolves once there is room for the
  // chunk. The assertion is causal rather than timed: the second write cannot resolve until
  // the first has actually been written, which is what the progress event reports.
  await check(
    'write() waits for room in the bufferSize budget',
    'streaming-backpressure',
    async () => {
      const file = `${root}/stream-write-budget.bin`;
      const chunk = new Uint8Array(4096).fill(7).buffer;
      const stream = await createWriteStream(file, { bufferSize: 4096 });

      const order: string[] = [];
      listenToWriteStreamProgress(stream.streamId, () => {
        order.push('written');
      });

      // Awaited, so it is definitely the one holding the budget when the next one asks.
      await stream.write(chunk);
      const second = stream.write(chunk).then(() => order.push('second'));
      await withTimeout(second, 15000, 'budgeted write');
      await stream.end();

      const firstWrite = order.indexOf('written');
      const secondResolved = order.indexOf('second');
      assert(
        firstWrite !== -1 && secondResolved > firstWrite,
        `second write() resolved before the first landed: ${order.join(' -> ')}`
      );

      const size = (await RNFS.stat(file)).size;
      assert(Number(size) === 8192, `expected 8192 bytes on disk, got ${size}`);
      return `order was ${order.join(' -> ')}, 8192 bytes on disk`;
    }
  );

  // The failure mode back-pressure introduces: close() has to release a read loop parked on
  // its JS consumer. `Promise.await()` is non-cancellable on both platforms, so if the
  // interrupt is wrong this does not fail - it never returns.
  await check(
    'close() releases a read loop parked on its consumer',
    'streaming-backpressure',
    async () => {
      const file = `${root}/stream-close-parked.txt`;
      await RNFS.writeFile(file, 'c'.repeat(512 * 1024), 'utf8');

      const stream = await createReadStream(file, { bufferSize: 1024 });
      let chunks = 0;
      let endEvent: { bytesRead: number; success: boolean } | null = null;
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      listenToReadStreamData(stream.streamId, async () => {
        chunks += 1;
        if (chunks === 1) await held;
      });
      listenToReadStreamEnd(stream.streamId, (e) => {
        endEvent = e;
      });

      stream.start().catch(() => {});
      // Long enough for the reader to reach the first chunk and park on it.
      for (let i = 0; i < 100 && chunks === 0; i++) await delay(10);
      assert(chunks > 0, 'no chunk was delivered, so the reader never parked');

      await withTimeout(stream.close(), 15000, 'close() while parked');
      release();
      await delay(200);

      const held2 = chunks;
      assert(
        endEvent !== null,
        "close() during an active read produced no end event - on Android the job's " +
          'finally used to clear the listener before close() could emit'
      );
      assert(
        endEvent!.success === false,
        `end event reported success: true after close() at chunk ${held2}`
      );
      return (
        `closed while parked at chunk ${held2}, end reported ` +
        `success=false bytesRead=${endEvent!.bytesRead}`
      );
    }
  );

  // The budget admits an oversized chunk on its own rather than waiting for room that can
  // never appear. Get that wrong and this deadlocks instead of failing.
  await check(
    'a chunk larger than bufferSize is still written',
    'streaming-backpressure',
    async () => {
      const file = `${root}/stream-oversized.bin`;
      const stream = await createWriteStream(file, { bufferSize: 1024 });
      const big = new Uint8Array(64 * 1024).fill(3).buffer;

      await withTimeout(stream.write(big), 15000, 'oversized write');
      await withTimeout(stream.end(), 15000, 'end after oversized write');

      const size = Number((await RNFS.stat(file)).size);
      assert(size === 65536, `expected 65536 bytes on disk, got ${size}`);
      return '64 KB chunk written through a 1 KB budget';
    }
  );

  // Ending the stream has to admit anyone still waiting for room, or their write() never
  // settles. Resolving and rejecting are both acceptable; hanging is not.
  await check(
    'a write parked on a full budget settles when the stream ends',
    'streaming-backpressure',
    async () => {
      const file = `${root}/stream-parked-write.bin`;
      const stream = await createWriteStream(file, { bufferSize: 4096 });
      const chunk = new Uint8Array(4096).fill(9).buffer;

      await stream.write(chunk);
      const parked = stream
        .write(chunk)
        .then(() => 'resolved')
        .catch(() => 'rejected');

      await withTimeout(stream.end(), 15000, 'end with a parked write');
      const outcome = await withTimeout(parked, 15000, 'parked write');
      return `parked write ${outcome} rather than hanging`;
    }
  );

  await check(
    'createWriteStream() rejects a zero bufferSize',
    'streaming-validation',
    async () => {
      // `bufferSize` is now the write queue's byte budget, so 0 would admit nothing.
      let rejected = false;
      let message = '';
      try {
        await createWriteStream(`${root}/zero-write-buffer.bin`, {
          bufferSize: 0,
        });
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'accepted bufferSize: 0 on a write stream');
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  // flush() used to set a flag consulted only after the next chunk on iOS, and to flush
  // userspace from the caller's coroutine on Android. Neither guaranteed anything, and both
  // resolved regardless. It is now ordered through the writer and syncs.
  await check(
    'flush() puts earlier writes on disk before it resolves',
    'streaming-flush',
    async () => {
      const file = `${root}/stream-flush.bin`;
      const stream = await createWriteStream(file);
      const chunk = new Uint8Array(4096).fill(5).buffer;

      await stream.write(chunk);
      await withTimeout(stream.flush(), 15000, 'flush');

      // Read the file without closing the stream: only a real flush makes this visible.
      const size = Number((await RNFS.stat(file)).size);
      assert(
        size === 4096,
        `expected 4096 bytes visible after flush(), got ${size}`
      );

      await stream.end();
      return 'flush() made 4096 bytes visible while the stream was still open';
    }
  );

  await check(
    'flush() on a finished stream rejects rather than hanging',
    'streaming-flush',
    async () => {
      const file = `${root}/stream-flush-closed.bin`;
      const stream = await createWriteStream(file);
      await stream.write(new Uint8Array(16).fill(1).buffer);
      await stream.end();

      let rejected = false;
      let message = '';
      try {
        await withTimeout(stream.flush(), 10000, 'flush after end');
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'flush() after end() resolved');
      return `rejected: ${message.slice(0, 80)}`;
    }
  );

  // progress used to be measured against the whole file, so a ranged read could never finish
  // at 1.0 - it topped out at (end - start + 1) / fileLength.
  await check(
    'progress reaches 1.0 on a ranged read',
    'streaming-progress',
    async () => {
      const file = `${root}/stream-progress-range.txt`;
      await RNFS.writeFile(file, 'q'.repeat(40 * 1024), 'utf8');

      const stream = await createReadStream(file, {
        bufferSize: 1024,
        start: 8 * 1024,
        end: 24 * 1024 - 1,
      });
      let last = 0;
      let totalBytes = 0;
      const done = new Promise<void>((resolve) => {
        listenToReadStreamData(stream.streamId, () => {});
        listenToReadStreamProgress(stream.streamId, (e) => {
          last = e.progress;
          totalBytes = e.totalBytes;
        });
        listenToReadStreamEnd(stream.streamId, () => resolve());
      });
      await stream.start();
      await withTimeout(done, 15000, 'ranged progress');

      assert(
        totalBytes === 16 * 1024,
        `totalBytes was ${totalBytes}, expected the range length 16384`
      );
      assert(
        Math.abs(last - 1) < 1e-9,
        `final progress was ${last}, expected 1.0`
      );
      return `final progress ${last} over totalBytes ${totalBytes}`;
    }
  );

  await check(
    'createWriteStream() appends when asked',
    'streaming-append',
    async () => {
      const file = `${root}/stream-append.txt`;
      await RNFS.writeFile(file, 'first;', 'utf8');

      const stream = await createWriteStream(file, { append: true });
      await stream.write(stringToArrayBuffer('second', 'utf8'));
      // `end()` is documented as an alias for `close()` (docs/FILE_STREAM.md:227-228), so
      // exactly one of them terminates the stream. Calling the second reports ENOENT, which
      // is why `_filestream.ts` wraps its own cleanup in `closeQuietly`.
      await stream.end();

      const back = await readText(file);
      assert(
        back === 'first;second',
        `append gave ${JSON.stringify(back)}, expected "first;second"`
      );
      return 'appended rather than truncated';
    }
  );

  await check(
    'write stream getPosition() tracks bytes written',
    'streaming-position',
    async () => {
      const file = `${root}/stream-position.txt`;
      const stream = await createWriteStream(file);

      // `write()` resolves when the chunk is *accepted*, not when it reaches the file - the
      // same distinction behind the close-truncation bug - so `position` does not advance
      // until the background writer drains the queue. Reading it straight after `write()`
      // returned 0 or 10 depending on timing. The progress event is the signal that bytes
      // actually landed.
      const wrote = new Promise<number>((resolve) => {
        listenToWriteStreamProgress(stream.streamId, (e) =>
          resolve(e.bytesWritten)
        );
      });
      await stream.write(stringToArrayBuffer('0123456789', 'utf8'));
      const reported = await withTimeout(wrote, 15000, 'write progress event');

      // Before terminating: `end()` drains and drops the registry entry, after which the
      // handle no longer resolves.
      const position = await stream.getPosition();
      await stream.end();

      assert(
        reported === 10,
        `progress event reported ${reported} bytes, wrote 10`
      );
      assert(
        position === 10,
        `getPosition() reported ${position} after the write had landed`
      );
      assert(
        typeof position === 'number',
        `getPosition() returned ${typeof position}, not a number - a bigint leaked through`
      );
      return `progress ${reported}, position ${position} after 10 bytes`;
    }
  );

  await check(
    'readStream() rejects for a missing file',
    'streaming-errors',
    async () => {
      let rejected = false;
      let message = '';
      try {
        await readStream(`${root}/definitely-not-here.txt`, 'utf8');
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'resolved for a file that does not exist');
      return `rejected: ${message.slice(0, 80)}`;
    }
  );

  // --- stopDownload -------------------------------------------------------------------------
  // The least-exercised code on the branch: it is the fallback branch of the new downloadFile
  // wrapper, where the `complete` event never arrives and the promise has to settle anyway.
  //
  // Deliberately does NOT assert that the transfer was cut short. Metro serves the bundle from
  // memory over loopback, so whether stopDownload lands mid-flight is a race against the host's
  // disk and network - asserting on it would be asserting on the peer, which has produced two
  // false failures on this branch already. What must hold either way is that the promise
  // settles rather than hanging forever.
  await check(
    'stopDownload() settles an in-flight download',
    'stop-download',
    async () => {
      // The JS bundle, not /status: several MB rather than a few bytes, so there is usually
      // something in flight to stop.
      const url = `http://localhost:8081/index.bundle?platform=${Platform.OS}&dev=true&minify=false`;
      const dest = `${root}/stopped.bundle`;

      const { jobId, promise } = RNFS.downloadFile({
        fromUrl: url,
        toFile: dest,
      });

      // Long enough for the request to be issued, short enough to usually beat 4 MB.
      await delay(50);
      await RNFS.stopDownload(jobId);

      let outcome: string;
      try {
        const result = await withTimeout(promise, 30000, 'stopped download');
        outcome = `resolved (statusCode=${result.statusCode}, bytes=${result.bytesWritten})`;
      } catch (e: any) {
        outcome = `rejected: ${(e?.message ?? String(e)).slice(0, 60)}`;
      }

      assert(
        !outcome.includes('timed out'),
        'the promise never settled after stopDownload - the wrapper hung'
      );
      return `jobId ${jobId} ${outcome}`;
    }
  );

  await check(
    'stopDownload() on an unknown job does not hang',
    'stop-download',
    async () => {
      let outcome = 'resolved';
      try {
        await withTimeout(
          RNFS.stopDownload(999999),
          10000,
          'stopDownload(unknown)'
        );
      } catch (e: any) {
        outcome = `rejected: ${(e?.message ?? String(e)).slice(0, 60)}`;
        assert(
          !outcome.includes('timed out'),
          'stopDownload() never settled for an unknown jobId'
        );
      }
      return outcome;
    }
  );

  // --- content:// URIs in exists() and unlink() ----------------------------------------------
  // Documented as a deliberate 4.x improvement over 3.x but never exercised. Needs a real
  // MediaStore entry; this creates its own rather than reusing the one above, which the
  // MediaStore check deletes.
  if (Platform.OS === 'android') {
    await check(
      'exists() and unlink() resolve a content:// URI',
      'content-uri',
      async () => {
        const source = `${root}/content-uri-source.png`;
        const PNG_1PX_BASE64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        await RNFS.writeFile(source, PNG_1PX_BASE64, 'base64');

        const uri = await MediaStore.copyToMediaStore(
          {
            name: `rnfs2-content-${Date.now()}.png`,
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

        assert(
          await RNFS.exists(uri),
          'exists() said false for a content:// URI that had just been created'
        );

        await RNFS.unlink(uri);

        assert(
          !(await RNFS.exists(uri)),
          'exists() still said true after unlink() removed the entry'
        );
        return 'created, found, unlinked and confirmed gone';
      }
    );

    // 3.x rejected here; 4.x resolving false is the documented fix, and a missing entry must
    // not be confused with a malformed URI.
    await check(
      'exists() resolves false for an absent content:// URI',
      'content-uri',
      async () => {
        const absent = 'content://media/external/images/media/999999999';
        assert(
          !(await RNFS.exists(absent)),
          'exists() said true for a MediaStore id that does not exist'
        );
        return 'resolved false rather than rejecting';
      }
    );

    // hash() resolves a content:// URI through the deprecated "_data" column, which is not
    // guaranteed to be populated under scoped storage on API 29+. Whether it is populated for
    // an entry the app inserted itself is empirical, so ask the device.
    await check('hash() digests a content:// URI', 'content-uri', async () => {
      const source = `${root}/content-uri-hash.png`;
      const PNG_1PX_BASE64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      await RNFS.writeFile(source, PNG_1PX_BASE64, 'base64');
      const expected = await RNFS.hash(source, 'md5');

      const uri = await MediaStore.copyToMediaStore(
        {
          name: `rnfs2-hash-${Date.now()}.png`,
          parentFolder: 'RNFS2Verify',
          mimeType: 'image/png',
        },
        MediaStore.MEDIA_IMAGE,
        source
      );

      try {
        // The control: stat() reads through the ContentResolver, so a failure here means the
        // URI is bad and says nothing about hash().
        const stat = await RNFS.stat(uri);
        assert(stat.size > 0, `stat reported size ${stat.size} for ${uri}`);

        const actual = await RNFS.hash(uri, 'md5');
        assert(
          actual === expected,
          `hash() returned ${actual} for the content:// URI, but the same bytes on disk ` +
            `hash to ${expected}`
        );
        return `stat and hash both resolved it; md5=${actual}, so "_data" is populated here`;
      } finally {
        await RNFS.unlink(uri).catch(() => {});
      }
    });

    // The same call against a provider with no "_data" column at all, which MediaStore's
    // populated one masks: a FileProvider cursor exposes only DISPLAY_NAME and SIZE. Its URI is
    // a plain string, so this needs no picker and no native helper.
    await check(
      'hash() digests a content:// URI with no "_data" column',
      'content-uri',
      async () => {
        const name = `fileprovider-${Date.now()}.txt`;
        const file = `${root}/${name}`;
        await RNFS.writeFile(file, 'the bytes under test', 'utf8');
        const expected = await RNFS.hash(file, 'md5');

        const uri = `content://fs2.example.fileprovider/files/${root.split('/').pop()}/${name}`;

        // The control again: if readFile() can read it, anything hash() does differently is ours.
        let readBack: string | ArrayBuffer;
        try {
          readBack = await RNFS.readFile(uri, 'utf8');
        } catch (e: any) {
          throw new Error(
            `the control failed, so this says nothing about hash(): readFile(${uri}) ` +
              `threw ${e?.message ?? e}`
          );
        }
        assert(
          readBack === 'the bytes under test',
          `readFile() returned ${JSON.stringify(readBack)} for ${uri}`
        );

        const actual = await RNFS.hash(uri, 'md5');
        assert(
          actual === expected,
          `hash() returned ${actual}, expected ${expected}`
        );
        return `readFile and hash agree on a _data-less provider; md5=${actual}`;
      }
    );

    // hash() raises both codes on the way in rather than from an explicit guard: EISDIR from
    // getFileUri, ENOENT from getInputStream. Android-only because only the Kotlin path changed.
    await check('hash() rejects ENOENT for a missing file', 'content-uri', () =>
      expectRejection(
        () => RNFS.hash(`${root}/definitely-not-here.txt`, 'md5'),
        'ENOENT'
      )
    );

    await check('hash() rejects EISDIR for a directory', 'content-uri', () =>
      expectRejection(() => RNFS.hash(root, 'md5'), 'EISDIR')
    );
  } else {
    await skip(
      'exists() and unlink() resolve a content:// URI',
      'content-uri',
      'Android-only; iOS has no MediaStore and no content:// scheme'
    );
  }

  // --- Write-side failure paths ---------------------------------------------------------------
  // Read-side errors were covered; write-side were not. These use a path whose parent is a
  // regular file, which is ENOTDIR on both platforms - deterministic, and it needs no special
  // permissions or a full disk to provoke.
  await check(
    'writeStream() rejects when the destination cannot be created',
    'streaming-write-errors',
    async () => {
      const blocker = `${root}/not-a-directory.txt`;
      await RNFS.writeFile(blocker, 'x', 'utf8');

      let rejected = false;
      let message = '';
      try {
        await withTimeout(
          writeStream(`${blocker}/child.txt`, 'payload', 'utf8'),
          15000,
          'writeStream to an unwritable path'
        );
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'resolved for a path whose parent is a regular file');
      assert(
        !message.includes('timed out'),
        'writeStream() hung instead of rejecting'
      );
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  // The interesting one: this drives the settle() path in copyFileWithProgress, where the read
  // stream and the write stream both have to be torn down and the promise rejected. A leak
  // here shows up as a hang rather than a wrong value.
  await check(
    'copyFileWithProgress() rejects for an unwritable destination',
    'streaming-write-errors',
    async () => {
      const source = `${root}/copy-fail-src.txt`;
      await RNFS.writeFile(source, 'a'.repeat(64 * 1024), 'utf8');
      const blocker = `${root}/not-a-directory.txt`;

      let rejected = false;
      let message = '';
      try {
        await withTimeout(
          copyFileWithProgress(source, `${blocker}/child.bin`, {
            bufferSize: 4096,
          }),
          20000,
          'copyFileWithProgress to an unwritable path'
        );
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'resolved despite an unwritable destination');
      assert(
        !message.includes('timed out'),
        'copyFileWithProgress() hung - a stream was probably left open'
      );
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  await check(
    'createWriteStream() rejects for a directory path',
    'streaming-write-errors',
    async () => {
      const dir = `${root}/a-real-directory`;
      await RNFS.mkdir(dir);

      let rejected = false;
      let message = '';
      try {
        const stream = await createWriteStream(dir);
        // Some platforms defer the failure to the first write rather than to open.
        await stream.write(stringToArrayBuffer('x', 'utf8'));
        await stream.end();
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'accepted a directory as a write destination');
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  await check(
    'createReadStream() rejects a zero bufferSize',
    'streaming-validation',
    async () => {
      // Unvalidated, this hung the Android read loop (read(b,0,0) returns 0, and the loop
      // only broke on -1) and reported a non-empty file as empty on iOS.
      const file = `${root}/zero-buffer.txt`;
      await RNFS.writeFile(file, 'some real content', 'utf8');

      let rejected = false;
      let message = '';
      try {
        await createReadStream(file, { bufferSize: 0 });
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'accepted bufferSize: 0');
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  await check(
    'createReadStream() rejects a negative start',
    'streaming-validation',
    async () => {
      // UInt64(start) traps on iOS, aborting the process.
      const file = `${root}/negative-start.txt`;
      await RNFS.writeFile(file, 'some real content', 'utf8');

      let rejected = false;
      let message = '';
      try {
        await createReadStream(file, { start: -1 });
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'accepted start: -1');
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  await check(
    'write() round-trips through read()',
    'buffer-marshalling',
    async () => {
      const file = `${root}/write-roundtrip.bin`;
      const body = 'A'.repeat(64 * 1024);
      await RNFS.writeFile(file, '', 'utf8');
      await withTimeout(RNFS.write(file, body, 0), 15000, 'write()');

      const got = (await RNFS.readFile(file, 'utf8')) as string;
      assert(
        got === body,
        `read back ${got.length} bytes, expected ${body.length}` +
          (got.length ? ` (starts ${JSON.stringify(got.slice(0, 8))})` : '')
      );
      return `${body.length} bytes byte-exact`;
    }
  );

  await check(
    'appendFile() round-trips through readFile()',
    'buffer-marshalling',
    async () => {
      const file = `${root}/append-roundtrip.txt`;
      await RNFS.writeFile(file, 'head-', 'utf8');
      await withTimeout(RNFS.appendFile(file, 'tail'), 15000, 'appendFile()');

      const got = (await RNFS.readFile(file, 'utf8')) as string;
      assert(got === 'head-tail', `got ${JSON.stringify(got)}`);
      return `appended to ${JSON.stringify(got)}`;
    }
  );

  await check('read() past EOF resolves empty', 'read-eof', async () => {
    const file = `${root}/read-eof.txt`;
    const body = 'hello world';
    await RNFS.writeFile(file, body, 'utf8');

    const got = await withTimeout(
      RNFS.read(file, 100, body.length, 'utf8'),
      10000,
      'read() at EOF'
    );
    assert(got === '', `expected empty string, got ${JSON.stringify(got)}`);
    return 'resolved with an empty string';
  });

  await check(
    'read() rejects a negative position',
    'read-validation',
    async () => {
      const file = `${root}/read-negative.txt`;
      await RNFS.writeFile(file, 'hello world', 'utf8');

      let rejected = false;
      let message = '';
      try {
        await withTimeout(RNFS.read(file, 5, -1, 'utf8'), 10000, 'read(-1)');
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(rejected, 'accepted position: -1');
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  await check(
    'moveFile() failure leaves the destination intact',
    'move-no-data-loss',
    async () => {
      const dest = `${root}/move-target.txt`;
      const kept = 'PRECIOUS-MOVE-TARGET';
      await RNFS.writeFile(dest, kept, 'utf8');
      assert(await RNFS.exists(dest), 'destination missing before the move');

      const missing = `${root}/no-such-source-${Date.now()}.txt`;
      let rejected = false;
      try {
        await withTimeout(RNFS.moveFile(missing, dest), 15000, 'moveFile()');
      } catch {
        rejected = true;
      }
      assert(rejected, 'moveFile() from a missing source resolved');

      const after = (await RNFS.exists(dest))
        ? await RNFS.readFile(dest, 'utf8')
        : '<DELETED>';
      assert(after === kept, `destination is now ${JSON.stringify(after)}`);
      return 'destination survived a rejected move';
    }
  );

  await check(
    'createWriteStream() does not create directories by default',
    'stream-createdirectories-default',
    async () => {
      const target = `${root}/absent-dir-${Date.now()}/out.bin`;
      let rejected = false;
      let message = '';
      try {
        const stream = await withTimeout(
          createWriteStream(target),
          10000,
          'createWriteStream()'
        );
        await stream.close();
      } catch (e: any) {
        rejected = true;
        message = e?.message ?? String(e);
      }
      assert(
        rejected,
        'opened into a missing directory, so the documented default of false is wrong'
      );
      return `rejected: ${message.slice(0, 90)}`;
    }
  );

  await check(
    'downloadFile() leaves an existing file intact on a 404',
    'download-404-no-clobber',
    async () => {
      const dest = `${root}/download-target.txt`;
      const kept = 'PRECIOUS-DOWNLOAD-TARGET';
      await RNFS.writeFile(dest, kept, 'utf8');

      const notFound = `http://localhost:8081/rnfs2-verify-no-such-route`;
      try {
        await withTimeout(
          RNFS.downloadFile({ fromUrl: notFound, toFile: dest }).promise,
          30000,
          'downloadFile() 404'
        );
      } catch {
        // A rejection is acceptable; the destination is what is under test.
      }

      const after = (await RNFS.exists(dest))
        ? await RNFS.readFile(dest, 'utf8')
        : '<DELETED>';
      assert(after === kept, `destination is now ${JSON.stringify(after)}`);
      return 'destination survived a 404';
    }
  );

  await check(
    'downloadFile() reports a 404 status',
    'download-status-code',
    async () => {
      const dest = `${root}/download-status.txt`;
      await RNFS.unlink(dest).catch(() => {});

      const notFound = `http://localhost:8081/rnfs2-verify-no-such-route`;
      const res = await withTimeout(
        RNFS.downloadFile({ fromUrl: notFound, toFile: dest }).promise,
        30000,
        'downloadFile() status'
      );
      assert(
        res.statusCode === 404,
        `reported statusCode=${res.statusCode}, expected 404`
      );
      return `statusCode=${res.statusCode}`;
    }
  );

  await check(
    'downloadFile() settles on an unwritable destination',
    'download-settles',
    async () => {
      const dir = `${root}/download-into-a-directory`;
      await RNFS.mkdir(dir);

      const started = Date.now();
      let outcome: string;
      try {
        const res = await withTimeout(
          RNFS.downloadFile({ fromUrl: DOWNLOAD_URL, toFile: dir }).promise,
          15000,
          'downloadFile() unwritable'
        );
        outcome = `resolved ${JSON.stringify(res)}`;
      } catch (e: any) {
        const message = e?.message ?? String(e);
        assert(
          !message.includes('timed out'),
          `promise never settled (${Date.now() - started}ms)`
        );
        outcome = `rejected: ${message.slice(0, 70)}`;
      }
      return `settled in ${Date.now() - started}ms: ${outcome}`;
    }
  );

  await skip(
    'downloadFile() resumes an interrupted download',
    'download-resume',
    'needs a byte-range capable server (Accept-Ranges + a validator); Metro serves neither, ' +
      'so URLSession never produces resume data. Covered manually against a range-capable fixture.'
  );

  await skip(
    'downloadFile() honours readTimeout',
    'download-read-timeout',
    'needs a server that accepts the socket and never responds; Metro always answers. ' +
      'Covered manually against a stalling fixture.'
  );

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

  const failedNames = checks
    .filter((c) => c.status === 'fail')
    .map((c) => c.name)
    .slice(0, 8);
  console.log(
    `RNFS2_VERIFY_SUMMARY_BEGIN${JSON.stringify({
      platform: report.platform,
      osVersion: report.osVersion,
      passed,
      failed,
      skipped,
      failedNames,
    })}RNFS2_VERIFY_SUMMARY_END`
  );
  return report;
}
