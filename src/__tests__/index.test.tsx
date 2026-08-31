// `var` (not `const`) so the declaration is hoisted above the hoisted `jest.mock` call and
// the `import` below. It is deliberately left uninitialised: an initialiser would run after
// `../index` has already captured the stub and would swap it for a different object.
var mockNitro: any;

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: { createHybridObject: () => (mockNitro ??= {}) },
}));

import RNFS from '../index';

describe('readDir', () => {
  const nativeItems = [
    {
      name: 'a.txt',
      path: '/tmp/a.txt',
      size: 3,
      mtime: 1700000000,
      ctime: 1600000000,
      isFile: true,
      isDirectory: false,
    },
    {
      name: 'sub',
      path: '/tmp/sub',
      size: 0,
      mtime: 1700000001,
      isFile: false,
      isDirectory: true,
    },
  ];

  beforeEach(() => {
    mockNitro.readDir = jest.fn().mockResolvedValue(nativeItems);
  });

  it('exposes isFile/isDirectory as accessors, matching stat()', async () => {
    const items = await RNFS.readDir('/tmp');

    expect(typeof items[0]!.isFile).toBe('function');
    expect(typeof items[0]!.isDirectory).toBe('function');
    expect(items[0]!.isFile()).toBe(true);
    expect(items[0]!.isDirectory()).toBe(false);
    expect(items[1]!.isFile()).toBe(false);
    expect(items[1]!.isDirectory()).toBe(true);
  });

  it('passes the remaining fields through unchanged', async () => {
    const items = await RNFS.readDir('/tmp');

    expect(items[0]).toMatchObject({
      name: 'a.txt',
      path: '/tmp/a.txt',
      size: 3,
    });
  });

  // Native emits whole seconds on both platforms; the public API is milliseconds, so that
  // `new Date(item.mtime)` works. Without the conversion it lands in January 1970.
  it('converts native seconds to milliseconds', async () => {
    const items = await RNFS.readDir('/tmp');

    expect(items[0]!.mtime).toBe(1700000000000);
    expect(items[0]!.ctime).toBe(1600000000000);
    expect(new Date(items[0]!.mtime).getUTCFullYear()).toBe(2023);
  });

  it('leaves a missing ctime undefined rather than converting it to 0', async () => {
    const items = await RNFS.readDir('/tmp');

    expect(items[1]!.ctime).toBeUndefined();
  });

  it('strips a file:// prefix before calling native', async () => {
    await RNFS.readDir('file:///tmp');

    expect(mockNitro.readDir).toHaveBeenCalledWith('/tmp');
  });
});

describe('stat', () => {
  beforeEach(() => {
    mockNitro.stat = jest.fn().mockResolvedValue({
      ctime: 1600000000,
      mtime: 1700000000,
      size: 42,
      mode: 0o644,
      type: 'file',
      originalFilepath: '/tmp/a.txt',
    });
  });

  it('exposes isFile/isDirectory as accessors', async () => {
    const result = await RNFS.stat('/tmp/a.txt');

    expect(result.isFile()).toBe(true);
    expect(result.isDirectory()).toBe(false);
  });

  // Same seconds-to-milliseconds conversion as readDir. 3.x returned Date objects built the
  // same way (master:src/index.ts:224-225); 4.x returns the millisecond value itself.
  it('converts native seconds to milliseconds', async () => {
    const result = await RNFS.stat('/tmp/a.txt');

    expect(result.mtime).toBe(1700000000000);
    expect(result.ctime).toBe(1600000000000);
  });

  it('reports a directory', async () => {
    mockNitro.stat = jest.fn().mockResolvedValue({
      ctime: 0,
      mtime: 0,
      size: 0,
      type: 'directory',
      originalFilepath: '/tmp/sub',
    });

    const result = await RNFS.stat('/tmp/sub');

    expect(result.isFile()).toBe(false);
    expect(result.isDirectory()).toBe(true);
    // mode is iOS-only on the native struct; the public type promises a number.
    expect(result.mode).toBe(0);
  });
});

describe('downloadFile', () => {
  beforeEach(() => {
    mockNitro.downloadFile = jest.fn().mockResolvedValue(1);
    for (const name of [
      'listenToDownloadBegin',
      'listenToDownloadProgress',
      'listenToDownloadComplete',
      'listenToDownloadError',
      'listenToDownloadCanBeResumed',
    ]) {
      mockNitro[name] = jest.fn(() => () => {});
    }
  });

  // 3.x resolved { jobId, statusCode, bytesWritten }. The Nitro method resolves the jobId
  // alone and sends the rest over the complete event, so the wrapper reassembles the 3.x shape.
  it('resolves the 3.x DownloadResult, not the bare jobId', async () => {
    mockNitro.listenToDownloadComplete = jest.fn(
      (jobId: number, cb: (e: any) => void) => {
        cb({ jobId, statusCode: 200, bytesWritten: 1024 });
        return () => {};
      }
    );

    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
    });

    await expect(promise).resolves.toEqual({
      jobId: expect.any(Number),
      statusCode: 200,
      bytesWritten: 1024,
    });
  });

  // A download stopped through stopDownload() settles without a complete event.
  it('falls back to the native jobId when no complete event arrives', async () => {
    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
    });

    await expect(promise).resolves.toEqual({
      jobId: 1,
      statusCode: undefined,
      bytesWritten: undefined,
    });
  });

  it('still invokes a caller-supplied complete callback', async () => {
    const complete = jest.fn();
    mockNitro.listenToDownloadComplete = jest.fn(
      (jobId: number, cb: (e: any) => void) => {
        cb({ jobId, statusCode: 204, bytesWritten: 0 });
        return () => {};
      }
    );

    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
      complete,
    });
    await promise;

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 204, bytesWritten: 0 })
    );
  });

  it('passes headers as the second argument', async () => {
    const headers = { Authorization: 'Bearer token' };

    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
      headers,
    });
    await promise;

    expect(mockNitro.downloadFile).toHaveBeenCalledTimes(1);
    // The generated ABI is downloadFile(options, headers?). Calling it with one argument
    // silently dropped the headers, because the parameter is optional.
    expect(mockNitro.downloadFile.mock.calls[0]).toHaveLength(2);
    expect(mockNitro.downloadFile.mock.calls[0][1]).toEqual(headers);
  });

  it('passes undefined headers when none are given', async () => {
    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
    });
    await promise;

    expect(mockNitro.downloadFile.mock.calls[0][1]).toBeUndefined();
  });

  it('forwards discretionary and cacheable without coercing them', async () => {
    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
      discretionary: true,
      cacheable: false,
    });
    await promise;

    const nitroOptions = mockNitro.downloadFile.mock.calls[0][0];
    expect(nitroOptions.discretionary).toBe(true);
    // iOS disables the shared cache only on an explicit `false`, so an unset value must not
    // become `false` on the way through.
    expect(nitroOptions.cacheable).toBe(false);
  });

  it('leaves unset discretionary and cacheable undefined', async () => {
    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
    });
    await promise;

    const nitroOptions = mockNitro.downloadFile.mock.calls[0][0];
    expect(nitroOptions.discretionary).toBeUndefined();
    expect(nitroOptions.cacheable).toBeUndefined();
  });

  it('allocates its own jobId and returns it', async () => {
    const { jobId, promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: '/tmp/a.bin',
    });
    await promise;

    expect(typeof jobId).toBe('number');
    expect(mockNitro.downloadFile.mock.calls[0][0].jobId).toBe(jobId);
  });

  it('strips a file:// prefix from the destination', async () => {
    const { promise } = RNFS.downloadFile({
      fromUrl: 'https://example.com/a.bin',
      toFile: 'file:///tmp/a.bin',
    });
    await promise;

    expect(mockNitro.downloadFile.mock.calls[0][0].toFile).toBe('/tmp/a.bin');
  });
});

// iOS file protection. 3.x accepted NSFileProtectionKey on writeFile/moveFile/copyFile as well
// as mkdir (master:ios/RNFSManager.m:117,236,418,446); the Nitro port dropped it from the first
// three. These cover the JS half of restoring it - that the option reaches the native call.
describe('file protection', () => {
  beforeEach(() => {
    mockNitro.moveFile = jest.fn().mockResolvedValue(undefined);
    mockNitro.copyFile = jest.fn().mockResolvedValue(undefined);
    mockNitro.writeFile = jest.fn().mockResolvedValue(undefined);
  });

  it('forwards fileProtection through moveFile', async () => {
    await RNFS.moveFile('/tmp/a', '/tmp/b', {
      fileProtection: 'NSFileProtectionComplete',
    });

    expect(mockNitro.moveFile).toHaveBeenCalledWith('/tmp/a', '/tmp/b', {
      fileProtection: 'NSFileProtectionComplete',
    });
  });

  it('forwards fileProtection through copyFile', async () => {
    await RNFS.copyFile('/tmp/a', '/tmp/b', {
      fileProtection: 'NSFileProtectionCompleteUnlessOpen',
    });

    expect(mockNitro.copyFile).toHaveBeenCalledWith('/tmp/a', '/tmp/b', {
      fileProtection: 'NSFileProtectionCompleteUnlessOpen',
    });
  });

  // writeFile has no options parameter of its own - protection rides in the same object as the
  // encoding, exactly as it did in 3.x (master:src/index.ts:264-268).
  it('forwards fileProtection given alongside writeFile encoding', async () => {
    await RNFS.writeFile('/tmp/a', 'hi', {
      encoding: 'utf8',
      fileProtection: 'NSFileProtectionNone',
    });

    expect(mockNitro.writeFile).toHaveBeenCalledWith(
      '/tmp/a',
      expect.any(ArrayBuffer),
      { fileProtection: 'NSFileProtectionNone' }
    );
  });

  it('omits protection when moveFile is called without options', async () => {
    await RNFS.moveFile('/tmp/a', '/tmp/b');

    expect(mockNitro.moveFile).toHaveBeenCalledWith('/tmp/a', '/tmp/b', {});
  });

  it('omits protection when writeFile is given a bare encoding string', async () => {
    await RNFS.writeFile('/tmp/a', 'hi', 'base64');

    expect(mockNitro.writeFile).toHaveBeenCalledWith(
      '/tmp/a',
      expect.any(ArrayBuffer),
      {}
    );
  });
});
