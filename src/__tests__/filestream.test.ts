// `var`, uninitialised: see the note in index.test.tsx.
var mockNitro: any;

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: { createHybridObject: () => (mockNitro ??= {}) },
}));

import {
  concatenateChunks,
  copyFileWithProgress,
  createReadStream,
  createWriteStream,
  processFileInChunks,
  readStream,
  writeStream,
} from '../_filestream';

type DataCb = (event: {
  streamId: string;
  data: ArrayBuffer;
  chunk: bigint;
  position: bigint;
}) => void;
type EndCb = (event: {
  streamId: string;
  bytesRead: bigint;
  success: boolean;
}) => void;
type WriteErrorEvent = { streamId: string; error: string; code?: string };
type WriteFinishEvent = {
  streamId: string;
  bytesWritten: bigint;
  success: boolean;
};

/**
 * A stand-in for the native stream layer.
 *
 * It reproduces the one property that drives B7 and B8: `startReadStream` emits every chunk
 * synchronously without awaiting the JS data callback, exactly as the native read loops do.
 */
function installFakeNative(content: Buffer) {
  const state = {
    requestedBufferSize: undefined as number | undefined,
    writes: [] as Buffer[],
    writesInFlight: 0,
    maxWritesInFlight: 0,
    closedRead: false,
    closedWrite: false,
    endedWrite: false,
    paused: false,
    pauseCount: 0,
    resumeCount: 0,
    data: null as DataCb | null,
    end: null as EndCb | null,
    endSuccess: true,
    writeError: null as ((event: WriteErrorEvent) => void) | null,
    writeFinish: null as ((event: WriteFinishEvent) => void) | null,
  };

  mockNitro.createReadStream = jest.fn(async (_path: string, options: any) => {
    state.requestedBufferSize = options?.bufferSize;
    return { streamId: 'read-1' };
  });
  mockNitro.createWriteStream = jest.fn(async () => ({ streamId: 'write-1' }));

  mockNitro.listenToReadStreamData = jest.fn((_id: string, cb: DataCb) => {
    state.data = cb;
    return () => {
      state.data = null;
    };
  });
  mockNitro.listenToReadStreamEnd = jest.fn((_id: string, cb: EndCb) => {
    state.end = cb;
    return () => {
      state.end = null;
    };
  });
  mockNitro.listenToReadStreamError = jest.fn(() => () => {});
  mockNitro.listenToReadStreamProgress = jest.fn(() => () => {});
  mockNitro.listenToWriteStreamProgress = jest.fn(() => () => {});
  mockNitro.listenToWriteStreamFinish = jest.fn(
    (_id: string, cb: (e: WriteFinishEvent) => void) => {
      state.writeFinish = cb;
      return () => {
        state.writeFinish = null;
      };
    }
  );
  mockNitro.listenToWriteStreamError = jest.fn(
    (_id: string, cb: (e: WriteErrorEvent) => void) => {
      state.writeError = cb;
      return () => {
        state.writeError = null;
      };
    }
  );

  mockNitro.pauseReadStream = jest.fn(async () => {
    state.paused = true;
    state.pauseCount += 1;
  });
  mockNitro.resumeReadStream = jest.fn(async () => {
    state.paused = false;
    state.resumeCount += 1;
  });
  mockNitro.closeReadStream = jest.fn(async () => {
    state.closedRead = true;
  });
  mockNitro.closeWriteStream = jest.fn(async () => {
    state.closedWrite = true;
  });
  mockNitro.endWriteStream = jest.fn(async () => {
    state.endedWrite = true;
    state.writeFinish?.({
      streamId: 'write-1',
      bytesWritten: BigInt(state.writes.reduce((n, b) => n + b.length, 0)),
      success: true,
    });
  });

  mockNitro.writeToStream = jest.fn(async (_id: string, data: ArrayBuffer) => {
    state.writesInFlight += 1;
    state.maxWritesInFlight = Math.max(
      state.maxWritesInFlight,
      state.writesInFlight
    );
    // Yield, so overlapping writes would actually overlap.
    await new Promise((r) => setTimeout(r, 0));
    state.writes.push(Buffer.from(new Uint8Array(data)));
    state.writesInFlight -= 1;
  });

  mockNitro.startReadStream = jest.fn(async () => {
    const size = state.requestedBufferSize ?? 8192;
    let chunk = 0;
    for (let offset = 0; offset < content.length; offset += size) {
      const slice = content.subarray(offset, offset + size);
      // Native does not await the callback — neither does this.
      state.data?.({
        streamId: 'read-1',
        data: new Uint8Array(slice).buffer,
        chunk: BigInt(chunk),
        position: BigInt(offset),
      });
      chunk += 1;
    }
    state.end?.({
      streamId: 'read-1',
      bytesRead: BigInt(content.length),
      success: state.endSuccess,
    });
  });

  return state;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('concatenateChunks', () => {
  it('joins chunks in order', () => {
    const result = concatenateChunks([
      new Uint8Array([1, 2]).buffer,
      new Uint8Array([3]).buffer,
      new Uint8Array([4, 5]).buffer,
    ]);

    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles no chunks', () => {
    expect(concatenateChunks([]).byteLength).toBe(0);
  });
});

describe('readStream', () => {
  it('decodes multi-byte characters that straddle chunk boundaries', async () => {
    // 日本語 is 3 bytes per character in UTF-8, so a 2-byte buffer splits every one of them.
    // Decoding each chunk on its own returns replacement characters.
    const source = '日本語 — héllo 🚀';
    const state = installFakeNative(Buffer.from(source, 'utf8'));

    const result = await readStream('/tmp/x.txt', 'utf8', { bufferSize: 2 });

    expect(result).toBe(source);
    expect(state.requestedBufferSize).toBe(2);
  });

  it('reassembles binary content across many chunks', async () => {
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    installFakeNative(bytes);

    const result = (await readStream('/tmp/x.bin', 'arraybuffer', {
      bufferSize: 7,
    })) as ArrayBuffer;

    expect(result.byteLength).toBe(1000);
    expect(Buffer.from(new Uint8Array(result)).equals(bytes)).toBe(true);
  });

  it('defaults to a 64 KB buffer rather than 128 bytes', async () => {
    const state = installFakeNative(Buffer.from('hi', 'utf8'));

    await readStream('/tmp/x.txt', 'utf8');

    expect(state.requestedBufferSize).toBe(64 * 1024);
  });

  it('closes the stream on the happy path', async () => {
    const state = installFakeNative(Buffer.from('hi', 'utf8'));

    await readStream('/tmp/x.txt', 'utf8');

    expect(state.closedRead).toBe(true);
  });

  it('unsubscribes every listener, including the error one', async () => {
    const unsubscribes = [jest.fn(), jest.fn(), jest.fn()] as jest.Mock[] as [
      jest.Mock,
      jest.Mock,
      jest.Mock,
    ];
    installFakeNative(Buffer.from('hi', 'utf8'));
    mockNitro.listenToReadStreamError = jest.fn(() => unsubscribes[2]);
    const realData = mockNitro.listenToReadStreamData;
    const realEnd = mockNitro.listenToReadStreamEnd;
    mockNitro.listenToReadStreamData = jest.fn((id: string, cb: DataCb) => {
      realData(id, cb);
      return unsubscribes[0];
    });
    mockNitro.listenToReadStreamEnd = jest.fn((id: string, cb: EndCb) => {
      realEnd(id, cb);
      return unsubscribes[1];
    });

    await readStream('/tmp/x.txt', 'utf8');

    expect(unsubscribes[0]).toHaveBeenCalled();
    expect(unsubscribes[1]).toHaveBeenCalled();
    expect(unsubscribes[2]).toHaveBeenCalled();
  });
});

describe('copyFileWithProgress', () => {
  it('writes chunks in order with only one write in flight', async () => {
    const bytes = Buffer.from(Array.from({ length: 500 }, (_, i) => i % 256));
    const state = installFakeNative(bytes);

    await copyFileWithProgress('/tmp/a', '/tmp/b', { bufferSize: 10 });

    expect(state.maxWritesInFlight).toBe(1);
    expect(Buffer.concat(state.writes).equals(bytes)).toBe(true);
  });

  it('pauses the read stream once the queue exceeds the high-water mark', async () => {
    const bytes = Buffer.alloc(500, 1);
    const state = installFakeNative(bytes);

    await copyFileWithProgress('/tmp/a', '/tmp/b', {
      bufferSize: 10,
      highWaterMark: 4,
    });

    expect(state.pauseCount).toBeGreaterThan(0);
  });

  it('closes both streams', async () => {
    const state = installFakeNative(Buffer.from('hello', 'utf8'));

    await copyFileWithProgress('/tmp/a', '/tmp/b', { bufferSize: 2 });

    expect(state.closedWrite).toBe(true);
    expect(state.closedRead).toBe(true);
  });
});

describe('processFileInChunks', () => {
  it('reports chunk index and position as numbers, in order', async () => {
    installFakeNative(Buffer.from('abcdefgh', 'utf8'));
    const seen: Array<{ index: number; position: number; text: string }> = [];

    await processFileInChunks(
      '/tmp/a',
      async (chunk, chunkIndex, position) => {
        await new Promise((r) => setTimeout(r, 0));
        seen.push({
          index: chunkIndex,
          position,
          text: Buffer.from(new Uint8Array(chunk)).toString('utf8'),
        });
      },
      { bufferSize: 3 }
    );

    expect(seen).toEqual([
      { index: 0, position: 0, text: 'abc' },
      { index: 1, position: 3, text: 'def' },
      { index: 2, position: 6, text: 'gh' },
    ]);
    expect(seen.every((s) => typeof s.index === 'number')).toBe(true);
  });

  it('closes the stream and rejects when the processor throws', async () => {
    const state = installFakeNative(Buffer.from('abcdef', 'utf8'));

    await expect(
      processFileInChunks(
        '/tmp/a',
        () => {
          throw new Error('boom');
        },
        { bufferSize: 3 }
      )
    ).rejects.toThrow('boom');

    expect(state.closedRead).toBe(true);
  });
});

describe('failure propagation', () => {
  it('copyFileWithProgress rejects when the write stream errors', async () => {
    // The read side still ends cleanly, so only the write-error channel reports this.
    const state = installFakeNative(Buffer.from('abcdef', 'utf8'));
    mockNitro.writeToStream = jest.fn(async () => {
      state.writeError?.({
        streamId: 'write-1',
        error: 'ENOSPC: No space left on device',
      });
    });

    await expect(
      copyFileWithProgress('/tmp/a', '/tmp/b', { bufferSize: 3 })
    ).rejects.toThrow('ENOSPC');
  });

  it('copyFileWithProgress rejects when the write finishes unsuccessfully', async () => {
    const state = installFakeNative(Buffer.from('abcdef', 'utf8'));
    mockNitro.endWriteStream = jest.fn(async () => {
      state.writeFinish?.({
        streamId: 'write-1',
        bytesWritten: BigInt(0),
        success: false,
      });
    });
    mockNitro.closeWriteStream = jest.fn(async () => {
      state.closedWrite = true;
      state.writeFinish?.({
        streamId: 'write-1',
        bytesWritten: BigInt(0),
        success: false,
      });
    });

    await expect(
      copyFileWithProgress('/tmp/a', '/tmp/b', { bufferSize: 3 })
    ).rejects.toThrow(/unsuccessfully|failed/i);
  });

  it('readStream rejects when the read ends unsuccessfully', async () => {
    const state = installFakeNative(Buffer.from('abcdef', 'utf8'));
    state.endSuccess = false;

    await expect(
      readStream('/tmp/a', 'utf8', { bufferSize: 3 })
    ).rejects.toThrow(/unsuccessfully|failed/i);
  });

  it('processFileInChunks rejects when the read ends unsuccessfully', async () => {
    const state = installFakeNative(Buffer.from('abcdef', 'utf8'));
    state.endSuccess = false;

    await expect(
      processFileInChunks('/tmp/a', () => {}, { bufferSize: 3 })
    ).rejects.toThrow(/unsuccessfully|failed/i);
  });

  it('writeStream rejects when the write finishes unsuccessfully', async () => {
    const state = installFakeNative(Buffer.from('', 'utf8'));
    mockNitro.endWriteStream = jest.fn(async () => {
      state.endedWrite = true;
      state.writeFinish?.({
        streamId: 'write-1',
        bytesWritten: BigInt(0),
        success: false,
      });
    });

    await expect(writeStream('/tmp/a', 'hello', 'utf8')).rejects.toThrow(
      /unsuccessfully|failed/i
    );
  });
});

describe('writeStream cleanup', () => {
  it('closes the native stream when encoding throws', async () => {
    const state = installFakeNative(Buffer.from('', 'utf8'));

    await expect(
      // A lone surrogate cannot be encoded.
      writeStream('/tmp/a', '\uD800', 'ascii-not-a-real-encoding' as never)
    ).rejects.toThrow();

    expect(state.closedWrite || state.endedWrite).toBe(true);
  });

  it('closes the native stream when the write rejects', async () => {
    const state = installFakeNative(Buffer.from('', 'utf8'));
    mockNitro.writeToStream = jest.fn(async () => {
      throw new Error('EIO: device failure');
    });

    await expect(writeStream('/tmp/a', 'hello', 'utf8')).rejects.toThrow('EIO');

    expect(state.closedWrite || state.endedWrite).toBe(true);
  });
});

describe('stream option validation', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fractional', 1.5],
    ['absurdly large', 1e12],
  ])('createReadStream rejects a %s bufferSize', async (_label, bufferSize) => {
    installFakeNative(Buffer.from('abc', 'utf8'));

    await expect(
      createReadStream('/tmp/a', { bufferSize: bufferSize as number })
    ).rejects.toThrow(/bufferSize/i);
  });

  it('createWriteStream rejects a zero bufferSize', async () => {
    installFakeNative(Buffer.from('', 'utf8'));

    await expect(
      createWriteStream('/tmp/a', { bufferSize: 0 })
    ).rejects.toThrow(/bufferSize/i);
  });

  it('createReadStream rejects a negative start', async () => {
    installFakeNative(Buffer.from('abc', 'utf8'));

    await expect(createReadStream('/tmp/a', { start: -1 })).rejects.toThrow(
      /start/i
    );
  });

  it('createReadStream rejects an end before the start', async () => {
    installFakeNative(Buffer.from('abc', 'utf8'));

    await expect(
      createReadStream('/tmp/a', { start: 10, end: 4 })
    ).rejects.toThrow(/end/i);
  });

  it('accepts a valid bufferSize and range', async () => {
    const state = installFakeNative(Buffer.from('abcdef', 'utf8'));

    await createReadStream('/tmp/a', { bufferSize: 4, start: 1, end: 4 });

    expect(state.requestedBufferSize).toBe(4);
  });
});

describe('processFileInChunks back-pressure', () => {
  /** Unlike the default fake, this one actually stops emitting while paused. */
  function installPauseHonouringNative(content: Buffer) {
    const state = installFakeNative(content);
    mockNitro.startReadStream = jest.fn(async () => {
      const size = state.requestedBufferSize ?? 8192;
      let chunk = 0;
      for (let offset = 0; offset < content.length; offset += size) {
        while (state.paused) {
          await new Promise((r) => setTimeout(r, 0));
        }
        state.data?.({
          streamId: 'read-1',
          data: new Uint8Array(content.subarray(offset, offset + size)).buffer,
          chunk: BigInt(chunk),
          position: BigInt(offset),
        });
        chunk += 1;
      }
      state.end?.({
        streamId: 'read-1',
        bytesRead: BigInt(content.length),
        success: state.endSuccess,
      });
    });
    return state;
  }

  it('pauses the reader when the processor falls behind', async () => {
    const state = installPauseHonouringNative(
      Buffer.from('x'.repeat(40), 'utf8')
    );

    await processFileInChunks(
      '/tmp/a',
      async () => {
        await new Promise((r) => setTimeout(r, 0));
      },
      { bufferSize: 1 }
    );

    expect(state.pauseCount).toBeGreaterThan(0);
    expect(state.resumeCount).toBeGreaterThan(0);
  });

  it('still processes every chunk in order while pausing', async () => {
    const state = installPauseHonouringNative(
      Buffer.from('abcdefghij', 'utf8')
    );
    const seen: number[] = [];

    await processFileInChunks(
      '/tmp/a',
      async (_chunk, index) => {
        await new Promise((r) => setTimeout(r, 0));
        seen.push(index);
      },
      { bufferSize: 1 }
    );

    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(state.closedRead).toBe(true);
  });
});

describe('pause/resume ordering', () => {
  /**
   * Native applies pause and resume as independent async operations with no mutual ordering,
   * so if JS lets them overlap they can land in the opposite order — the resume no-ops and
   * the late pause parks the reader with nothing left to wake it.
   */
  function installOverlapTrackingNative(content: Buffer) {
    const state = installFakeNative(content);
    // Writer is the bottleneck, so the watermark is actually reached.
    mockNitro.writeToStream = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    let pauseInFlight = 0;
    const overlaps = { count: 0 };

    mockNitro.pauseReadStream = jest.fn(async () => {
      state.pauseCount += 1;
      pauseInFlight += 1;
      await new Promise((r) => setTimeout(r, 100));
      state.paused = true;
      pauseInFlight -= 1;
    });
    mockNitro.resumeReadStream = jest.fn(async () => {
      state.resumeCount += 1;
      if (pauseInFlight > 0) overlaps.count += 1;
      state.paused = false;
    });
    mockNitro.startReadStream = jest.fn(async () => {
      const size = state.requestedBufferSize ?? 8192;
      let chunk = 0;
      for (let offset = 0; offset < content.length; offset += size) {
        await new Promise((r) => setTimeout(r, 1));
        while (state.paused) {
          await new Promise((r) => setTimeout(r, 1));
        }
        state.data?.({
          streamId: 'read-1',
          data: new Uint8Array(content.subarray(offset, offset + size)).buffer,
          chunk: BigInt(chunk),
          position: BigInt(offset),
        });
        chunk += 1;
      }
      state.end?.({
        streamId: 'read-1',
        bytesRead: BigInt(content.length),
        success: state.endSuccess,
      });
    });
    return { state, overlaps };
  }

  it('copyFileWithProgress never resumes while a pause is in flight', async () => {
    const { state, overlaps } = installOverlapTrackingNative(
      Buffer.from('x'.repeat(100), 'utf8')
    );

    await copyFileWithProgress('/tmp/a', '/tmp/b', { bufferSize: 1 });

    expect(state.pauseCount).toBeGreaterThan(0); // guard: the test must not be vacuous
    expect(overlaps.count).toBe(0);
  });

  it('processFileInChunks never resumes while a pause is in flight', async () => {
    const { state, overlaps } = installOverlapTrackingNative(
      Buffer.from('x'.repeat(100), 'utf8')
    );

    await processFileInChunks(
      '/tmp/a',
      async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
      { bufferSize: 1 }
    );

    expect(state.pauseCount).toBeGreaterThan(0); // guard: the test must not be vacuous
    expect(overlaps.count).toBe(0);
  });
});
