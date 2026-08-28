import {
  convertFs2StreamEventResultsToNitro,
  convertFs2StreamEventResultsToPlain,
  convertFs2StreamOptionsToNitroOptions,
  decodeContents,
  encodeContents,
  mapPropsWithBigInt,
} from '../utils';
import type {
  ReadStreamDataEvent,
  ReadStreamProgressEvent,
  WriteStreamProgressEvent,
} from '../types';

describe('mapPropsWithBigInt', () => {
  // Every Int64 field declared in src/nitro/Fs2Stream.nitro.ts must appear here,
  // otherwise it reaches JS as a bigint while src/types.ts promises a number.
  const int64Fields = [
    'start',
    'end',
    'chunk',
    'position',
    'bytesRead',
    'totalBytes',
    'bytesWritten',
    'lastChunkSize',
  ];

  it.each(int64Fields)('converts %s', (field) => {
    expect(mapPropsWithBigInt).toContain(field);
  });

  it('lists no field that does not exist on any event', () => {
    expect(mapPropsWithBigInt).not.toContain('chunks');
    expect(mapPropsWithBigInt.sort()).toEqual([...int64Fields].sort());
  });
});

describe('convertFs2StreamEventResultsToPlain', () => {
  it('hands ReadStreamDataEvent subscribers numbers, not bigints', () => {
    const nitroEvent = {
      streamId: 'stream-1',
      data: new ArrayBuffer(4),
      chunk: 7n,
      position: 512n,
    };

    const event = convertFs2StreamEventResultsToPlain(
      nitroEvent
    ) as ReadStreamDataEvent;

    expect(typeof event.chunk).toBe('number');
    expect(typeof event.position).toBe('number');
    expect(event.chunk).toBe(7);
    expect(event.position).toBe(512);
    // The one operation a bigint would break.
    expect(event.chunk + 1).toBe(8);
  });

  it('converts read progress events', () => {
    const event = convertFs2StreamEventResultsToPlain({
      streamId: 'stream-1',
      bytesRead: 100n,
      totalBytes: 1000n,
      progress: 0.1,
    }) as ReadStreamProgressEvent;

    expect(event).toEqual({
      streamId: 'stream-1',
      bytesRead: 100,
      totalBytes: 1000,
      progress: 0.1,
    });
  });

  it('converts write progress events', () => {
    const event = convertFs2StreamEventResultsToPlain({
      streamId: 'stream-1',
      bytesWritten: 2048n,
      lastChunkSize: 1024n,
    }) as WriteStreamProgressEvent;

    expect(event).toEqual({
      streamId: 'stream-1',
      bytesWritten: 2048,
      lastChunkSize: 1024,
    });
  });

  it('leaves non-Int64 fields untouched', () => {
    const data = new ArrayBuffer(8);
    const event = convertFs2StreamEventResultsToPlain({
      streamId: 'stream-1',
      data,
      chunk: 0n,
      position: 0n,
    }) as ReadStreamDataEvent;

    expect(event.streamId).toBe('stream-1');
    expect(event.data).toBe(data);
  });
});

describe('convertFs2StreamEventResultsToNitro', () => {
  it('round-trips back to bigint', () => {
    const plain: ReadStreamDataEvent = {
      streamId: 'stream-1',
      data: new ArrayBuffer(4),
      chunk: 7,
      position: 512,
    };

    const nitro = convertFs2StreamEventResultsToNitro(plain) as {
      chunk: bigint;
      position: bigint;
    };

    expect(typeof nitro.chunk).toBe('bigint');
    expect(nitro.chunk).toBe(7n);
    expect(nitro.position).toBe(512n);
  });
});

describe('convertFs2StreamOptionsToNitroOptions', () => {
  it('converts numeric options to bigint', () => {
    expect(
      convertFs2StreamOptionsToNitroOptions({
        bufferSize: 8192,
        start: 0,
        end: 1024,
      })
    ).toEqual({ bufferSize: 8192, start: 0n, end: 1024n });
  });

  it('drops explicitly-undefined options instead of throwing', () => {
    // `BigInt(undefined)` throws a TypeError, so `{ start: undefined }` used to blow up
    // rather than behaving like an omitted option.
    expect(() =>
      convertFs2StreamOptionsToNitroOptions({ start: undefined, end: 10 })
    ).not.toThrow();

    expect(
      convertFs2StreamOptionsToNitroOptions({ start: undefined, end: 10 })
    ).toEqual({ end: 10n });
  });

  it('handles empty options', () => {
    expect(convertFs2StreamOptionsToNitroOptions({})).toEqual({});
  });
});

describe('encodeContents / decodeContents', () => {
  it.each(['utf8', 'ascii', 'base64'] as const)(
    'round-trips %s',
    (encoding) => {
      const source = encoding === 'base64' ? 'aGVsbG8=' : 'hello';
      const buffer = encodeContents(source, encoding);

      expect(decodeContents(buffer, encoding)).toBe(source);
    }
  );

  it('encodes only the payload, not the whole allocation pool', () => {
    // Node hands out small Buffers as slices of a shared 8 KB pool, so `Buffer#buffer` is the
    // pool rather than the payload. Reading it directly leaked the pool's full length here.
    expect(encodeContents('hi', 'utf8').byteLength).toBe(2);
    expect(encodeContents('hi', 'ascii').byteLength).toBe(2);
    expect(encodeContents('aGk=', 'base64').byteLength).toBe(2);
  });

  it('round-trips multi-byte utf8', () => {
    const source = 'héllo — 日本語 🚀';
    const buffer = encodeContents(source, 'utf8');

    expect(buffer.byteLength).toBe(Buffer.byteLength(source, 'utf8'));
    expect(decodeContents(buffer, 'utf8')).toBe(source);
  });

  it('passes an ArrayBuffer through unchanged', () => {
    const source = new Uint8Array([1, 2, 3]).buffer;

    expect(encodeContents(source, 'arraybuffer')).toBe(source);
    expect(decodeContents(source, 'arraybuffer')).toBe(source);
  });

  it('copies only the view when given a TypedArray', () => {
    const view = new Uint8Array(new ArrayBuffer(16), 4, 3);
    view.set([7, 8, 9]);

    const result = encodeContents(view, 'arraybuffer');

    expect(result.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(result))).toEqual([7, 8, 9]);
  });
});
