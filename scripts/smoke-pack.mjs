// Packs the library, installs the tarball into a temp project and imports it from plain Node ESM.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies ?? {}).length > 0) throw new Error('dependencies must stay empty (zero runtime dependencies)');

const work = mkdtempSync(path.join(tmpdir(), 'bargein-smoke-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const out = run('npm', ['pack', '--silent', '--pack-destination', work], root).trim().split('\n').pop();
  writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', path.join(work, out)], work);
  const installed = path.join(work, 'node_modules', 'bargein');
  for (const f of ['dist/index.d.ts', 'dist/openai.d.ts', 'dist/gemini.d.ts', 'dist/worklets/player.js', 'dist/worklets/capture.js']) {
    if (!existsSync(path.join(installed, f))) throw new Error(`missing ${f} in the packed library`);
  }
  writeFileSync(path.join(work, 'check.mjs'), `
    import assert from 'node:assert/strict';
    import { computeAudioEndMs, floatToPcm16, encodeBase64, bytesToMs, StreamResampler } from 'bargein';
    import { createOpenAIBargeIn, toOpenAIAppend } from 'bargein/openai';
    import { createGeminiBargeIn, toGeminiRealtimeInput } from 'bargein/gemini';
    assert.equal(typeof window, 'undefined');
    assert.equal(computeAudioEndMs({ playedMs: 1804.6, receivedMs: 3000 }), 1804);
    assert.equal(bytesToMs(48000, 'pcm16'), 1000);
    assert.deepEqual(Array.from(floatToPcm16(new Float32Array([1, -1]))), [32767, -32768]);
    assert.equal(encodeBase64(new Uint8Array([0x66])), 'Zg==');
    assert.equal(new StreamResampler(48000, 24000).push(new Float32Array(48000)).length, 24000);
    assert.equal(toOpenAIAppend('QQ==').type, 'input_audio_buffer.append');
    assert.equal(toGeminiRealtimeInput('QQ==').realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
    assert.equal(typeof createOpenAIBargeIn, 'function');
    assert.equal(typeof createGeminiBargeIn, 'function');
  `);
  run('node', ['check.mjs'], work);
  console.log('smoke ok');
} finally {
  rmSync(work, { recursive: true, force: true });
}
