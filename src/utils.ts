import { Buffer } from 'buffer';

import type { Encoding } from './types';

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
      return Buffer.from(content, 'utf8').buffer;

    case 'ascii':
      if (typeof content !== 'string') {
        throw new Error('Content must be a string for ascii encoding');
      }
      return Buffer.from(content, 'ascii').buffer;

    case 'base64':
      if (typeof content !== 'string') {
        throw new Error('Content must be a string for base64 encoding');
      }
      return Buffer.from(content, 'base64').buffer;

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
