export function tone(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

export function zeroCrossHz(f32: ArrayLike<number>, rate: number): number {
  let z = 0;
  for (let i = 1; i < f32.length; i++) if (f32[i - 1] < 0 !== f32[i] < 0) z++;
  return z / 2 / (f32.length / rate);
}
