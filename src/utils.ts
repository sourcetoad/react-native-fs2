import { Buffer } from 'buffer';

import type {
  Encoding,
  EncodingOrOptions,
  DataEventPlain,
  DataEventNitro,
  StreamOptionPlain,
  StreamOptionNitro,
} from './types';

/**
 * Encodes content to ArrayBuffer based on encoding type
 */
export function encodeContents(
  content: string | ArrayBuffer,
  encodingType: Encoding
): ArrayBuffer {
  if (!content && content !== '') {
    throw new Error('Content cannot be null or undefined');
  }

  switch (encodingType) {
    case 'utf8':
      if (typeof content !== 'string') {
        throw new Error('Content must be a string for utf8 encoding');
      }
      return Buffer.from(content, 'utf8').buffer as ArrayBuffer;

    case 'ascii':
      if (typeof content !== 'string') {
        throw new Error('Content must be a string for ascii encoding');
      }
      return Buffer.from(content, 'ascii').buffer as ArrayBuffer;

    case 'base64':
      if (typeof content !== 'string') {
        throw new Error('Content must be a string for base64 encoding');
      }
      return Buffer.from(content, 'base64').buffer as ArrayBuffer;

    case 'arraybuffer':
      if (content instanceof ArrayBuffer) {
        return content;
      } else if (ArrayBuffer.isView(content)) {
        // Handle TypedArrays (Uint8Array, etc.) - ensure we return ArrayBuffer
        const buffer = content.buffer;
        if (buffer instanceof ArrayBuffer) {
          return buffer.slice(
            content.byteOffset,
            content.byteOffset + content.byteLength
          );
        } else {
          // Handle SharedArrayBuffer case by copying to ArrayBuffer
          const arrayBuffer = new ArrayBuffer(content.byteLength);
          const view = new Uint8Array(arrayBuffer);
          const sourceView = new Uint8Array(
            buffer,
            content.byteOffset,
            content.byteLength
          );
          view.set(sourceView);
          return arrayBuffer;
        }
      } else {
        throw new Error(
          'Content must be ArrayBuffer or TypedArray for arraybuffer encoding'
        );
      }

    default:
      throw new Error(`Unsupported encoding type: ${encodingType}`);
  }
}

/**
 * Decodes ArrayBuffer to string based on encoding type
 */
export function decodeContents(
  buffer: ArrayBuffer,
  encodingType: Encoding
): string | ArrayBuffer {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('Buffer must be an ArrayBuffer');
  }

  if (buffer.byteLength === 0 && encodingType !== 'arraybuffer') {
    return ''; // Return empty string for empty buffers (except arraybuffer)
  }

  switch (encodingType) {
    case 'utf8':
      return Buffer.from(buffer).toString('utf8');

    case 'ascii':
      return Buffer.from(buffer).toString('ascii');

    case 'base64':
      return Buffer.from(buffer).toString('base64');

    case 'arraybuffer':
      return buffer;

    default:
      throw new Error(`Unsupported encoding type: ${encodingType}`);
  }
}

/**
 * Utility function to validate encoding type
 */
export function isValidEncoding(
  encodingType: string
): encodingType is Encoding {
  return ['utf8', 'ascii', 'base64', 'arraybuffer'].includes(encodingType);
}

/**
 * Normalize file path
 */
export function normalizeFilePath(path: string): string {
  return path.startsWith('file://') ? path.slice(7) : path;
}

/**
 * Parse options
 */
export function parseOptions(encodingOrOptions?: EncodingOrOptions): {
  encoding: Encoding;
} {
  let options = { encoding: 'utf8' as Encoding };
  if (!encodingOrOptions) return options;
  if (typeof encodingOrOptions === 'string') {
    options.encoding = encodingOrOptions as Encoding;
  } else if (typeof encodingOrOptions === 'object') {
    options = { ...options, ...encodingOrOptions };
  }
  return options;
}

/**
 * Convert number to bigint
 */
export function numberToBigInt(number: number): bigint {
  return BigInt(number);
}

/**
 * Convert bigint to number
 */
export function bigIntToNumber(bigint: bigint): number {
  return Number(bigint);
}

/**
 * Map FS2 stream options with bigint
 */
export const mapPropsWithBigInt: string[] = [
  'start',
  'end',
  'chunks',
  'position',
  'bytesRead',
  'totalBytes',
  'bytesWritten',
  'lastChunkSize',
];

/**
 * Convert FS2 stream options to nitro options
 */
export function convertFs2StreamOptionsToNitroOptions(
  options: StreamOptionPlain
): StreamOptionNitro {
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      mapPropsWithBigInt.includes(key) ? numberToBigInt(value) : value,
    ])
  ) as StreamOptionNitro;
}

/**
 * Convert FS2 stream event results to nitro event results
 */
export function convertFs2StreamEventResultsToNitro(
  results: DataEventPlain
): DataEventNitro {
  return Object.fromEntries(
    Object.entries(results).map(([key, value]) => [
      key,
      mapPropsWithBigInt.includes(key) ? numberToBigInt(value) : value,
    ])
  ) as DataEventNitro;
}

/**
 * Convert FS2 stream event results to plain options
 */
export function convertFs2StreamEventResultsToPlain(
  results: DataEventNitro
): DataEventPlain {
  return Object.fromEntries(
    Object.entries(results).map(([key, value]) => [
      key,
      mapPropsWithBigInt.includes(key) ? bigIntToNumber(value) : value,
    ])
  ) as DataEventPlain;
}
