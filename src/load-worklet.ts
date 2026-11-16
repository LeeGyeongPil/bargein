import { BargeinError } from './errors.js';
import { captureWorkletSource, playerWorkletSource } from './generated/worklet-sources.js';

export type WorkletKind = 'player' | 'capture';

const loaded = new WeakMap<object, Set<string>>();

/** Subset of AudioWorkletNode used here, so tests and other Web Audio implementations can plug in. */
export type AudioWorkletNodeCtor = new (ctx: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) => AudioWorkletNode;

export function workletNodeCtor(override?: AudioWorkletNodeCtor): AudioWorkletNodeCtor {
  const ctor = override ?? (globalThis as { AudioWorkletNode?: AudioWorkletNodeCtor }).AudioWorkletNode;
  if (!ctor) {
    throw new BargeinError('WORKLET_LOAD_FAILED', 'AudioWorkletNode is not available in this environment. Use a browser with AudioWorklet support, or pass the AudioWorkletNode constructor of your Web Audio implementation via the `AudioWorkletNode` option.');
  }
  return ctor;
}

/** Register the worklet once per context. Uses an inline Blob URL unless `workletUrl` is given. */
export async function loadWorklet(ctx: BaseAudioContext, kind: WorkletKind, workletUrl?: string): Promise<void> {
  const key = `${kind}:${workletUrl ?? 'inline'}`;
  const set = loaded.get(ctx) ?? new Set<string>();
  if (set.has(key)) return;
  const worklet = (ctx as { audioWorklet?: AudioWorklet }).audioWorklet;
  if (!worklet) {
    throw new BargeinError('WORKLET_LOAD_FAILED', 'This AudioContext has no audioWorklet. Use a real-time AudioContext in a browser with AudioWorklet support (secure context: https or localhost).');
  }
  let url = workletUrl;
  let blobUrl: string | null = null;
  try {
    if (!url) {
      const source = kind === 'player' ? playerWorkletSource : captureWorkletSource;
      blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      url = blobUrl;
    }
    await worklet.addModule(url);
  } catch (err) {
    const hint = workletUrl
      ? `Check that "${workletUrl}" is served as JavaScript from your origin.`
      : 'A strict Content-Security-Policy may block blob: URLs. Serve node_modules/bargein/dist/worklets/' + kind + '.js from your own origin and pass its URL as the `workletUrl` option.';
    throw new BargeinError('WORKLET_LOAD_FAILED', `Could not load the ${kind} AudioWorklet (${err instanceof Error ? err.message : String(err)}). ${hint}`);
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
  set.add(key);
  loaded.set(ctx, set);
}
