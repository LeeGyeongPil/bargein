import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import * as gemini from '../src/gemini.js';
import * as openai from '../src/openai.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('package shape', () => {
  it('has no runtime dependencies and is ESM with the documented entry points', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.type).toBe('module');
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining(['.', './openai', './gemini', './worklets/*']));
    expect(pkg.engines.node).toBeTruthy();
    expect(pkg.license).toBe('MIT');
  });

  it('publishes only importable files and carries repository metadata', () => {
    expect(pkg.files).not.toContain('mock');
    expect(pkg.repository?.url).toMatch(/github\.com\/LeeGyeongPil\/bargein/);
    expect(pkg.homepage).toBeTruthy();
    expect(pkg.bugs?.url).toBeTruthy();
  });

  it('exports the documented API', () => {
    for (const name of ['createPlayer', 'createCapture', 'computeAudioEndMs', 'bytesToMs', 'PlaybackCore', 'CaptureCore', 'StreamResampler', 'BargeinError', 'floatToPcm16', 'encodeBase64'])
      expect(core).toHaveProperty(name);
    expect(openai).toHaveProperty('createOpenAIBargeIn');
    expect(gemini).toHaveProperty('createGeminiBargeIn');
  });

  it('importing the library does not touch browser globals', () => {
    // The packed build is imported from plain Node by `npm run smoke:pack`.
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe('undefined');
  });
});
