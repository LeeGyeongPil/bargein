// Synthetic audio for the practice server: a sine whose pitch steps every 500 ms,
// so you can hear where playback was cut. No external audio files, no licences.
export const STEP_HZ = [220, 262, 330, 392, 440, 523];

export function stepTone(totalMs, rate = 24000, stepMs = 500) {
  const n = Math.round((rate * totalMs) / 1000);
  const out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const hz = STEP_HZ[Math.floor((i / rate) * (1000 / stepMs)) % STEP_HZ.length];
    phase += (2 * Math.PI * hz) / rate;
    out[i] = Math.round(0.4 * 0x7fff * Math.sin(phase));
  }
  return out;
}

export function toBase64(i16) {
  return Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength).toString('base64');
}
