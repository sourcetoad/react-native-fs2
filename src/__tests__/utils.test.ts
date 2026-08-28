import {
  convertFs2StreamEventResultsToNitro,
  convertFs2StreamEventResultsToPlain,
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
