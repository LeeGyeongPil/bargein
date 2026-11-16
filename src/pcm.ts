import { BargeinError } from './errors.js';

export type PcmFormat = 'pcm16' | 'g711_ulaw' | 'g711_alaw';

/** Float32 [-1, 1] to PCM16. Out-of-range values are clipped to 32767 / -32768. */
export function floatToPcm16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/** PCM16 to Float32 in [-1, 1). */
export function pcm16ToFloat(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 0x8000;
  return out;
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Base64-encode bytes. Works in browsers and Node without Buffer. Assumes little-endian hosts for Int16Array input. */
export function encodeBase64(data: ArrayBuffer | ArrayBufferView): string {
  const bytes = toBytes(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Decode base64 to bytes. Throws BargeinError('BAD_AUDIO') for invalid input. */
export function decodeBase64(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new BargeinError('BAD_AUDIO', 'Invalid base64 audio payload. Pass the "delta"/"data" string exactly as received.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reinterpret little-endian PCM16 bytes as Int16Array (copies, so alignment never matters). */
export function bytesToPcm16(bytes: Uint8Array): Int16Array {
  if (bytes.length % 2 !== 0) {
    throw new BargeinError('BAD_AUDIO', `PCM16 audio must have an even number of bytes, got ${bytes.length}. A chunk was probably cut in the middle of a sample.`);
  }
  const out = new Int16Array(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Decode one G.711 mu-law byte to PCM16. */
export function ulawToPcm16Sample(byte: number): number {
  const u = ~byte & 0xff;
  const t = (((u & 0x0f) << 3) + 0x84) << ((u & 0x70) >> 4);
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

/** Decode one G.711 A-law byte to PCM16. */
export function alawToPcm16Sample(byte: number): number {
  const a = byte ^ 0x55;
  let t = (a & 0x0f) << 4;
  const seg = (a & 0x70) >> 4;
  if (seg === 0) t += 8;
  else if (seg === 1) t += 0x108;
  else t = (t + 0x108) << (seg - 1);
  return a & 0x80 ? t : -t;
}

/** Decode G.711 bytes (8 kHz, 1 byte per sample) to PCM16. */
export function g711ToPcm16(bytes: Uint8Array, format: 'g711_ulaw' | 'g711_alaw'): Int16Array {
  const out = new Int16Array(bytes.length);
  const fn = format === 'g711_ulaw' ? ulawToPcm16Sample : alawToPcm16Sample;
  for (let i = 0; i < bytes.length; i++) out[i] = fn(bytes[i]);
  return out;
}

/** Duration in milliseconds (fractional) of `bytes` of audio in `format`. Default rate: 24000 for pcm16, 8000 for G.711. */
export function bytesToMs(bytes: number, format: PcmFormat, rate?: number): number {
  const bytesPerSample = format === 'pcm16' ? 2 : 1;
  const r = rate ?? (format === 'pcm16' ? 24000 : 8000);
  if (!(r > 0)) throw new RangeError(`rate must be positive, got ${r}`);
  return (bytes / bytesPerSample / r) * 1000;
}
