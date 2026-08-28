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
