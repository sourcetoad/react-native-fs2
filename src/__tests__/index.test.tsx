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
      mtime: 1700000000,
      ctime: 1600000000,
    });
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
