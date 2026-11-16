// DOM-free playback logic. The AudioWorklet wrapper only forwards messages and calls process().
// No imports on purpose: this file is inlined into the worklet bundle.

export interface PlaybackSnapshot {
  /** Item that is playing now (or played last). */
  itemId: string | null;
  contentIndex: number;
  /** Source-rate samples of this item already rendered (fractional). */
  playedSrc: number;
  /** Source-rate samples of this item received so far. */
  receivedSrc: number;
  /** True once markEnded() was called for the item (server finished sending it). */
  ended: boolean;
  /** Output frames rendered as silence while waiting for data (after the first sample). */
  underrunFrames: number;
  /** Source samples queued and not yet rendered. */
  queuedSrc: number;
  /** Output frames rendered since creation or the last clear(). */
  outFrames: number;
}

export type PlaybackEvent = 'started' | 'drained' | 'underrun';

interface Segment { itemId: string; samples: Float32Array }
interface ItemState { contentIndex: number; received: number; played: number; ended: boolean }

export class PlaybackCore {
  readonly srcRate: number;
  readonly outRate: number;
  private ratio: number;
  private jitterSamples: number;
  private segs: Segment[] = [];
  private pos = 0; // fractional read position inside segs[0]
  private queuedTotal = 0;
  private items = new Map<string, ItemState>();
  private lastItem: string | null = null;
  private playing = false;
  private everStarted = false;
  private underrunFrames = 0;
  private outFrames = 0;
  private events: PlaybackEvent[] = [];

  constructor(srcRate: number, outRate: number, opts: { jitterSamples?: number } = {}) {
    if (!(srcRate > 0) || !(outRate > 0)) throw new RangeError(`sample rates must be positive, got ${srcRate}, ${outRate}`);
    this.srcRate = srcRate;
    this.outRate = outRate;
    this.ratio = srcRate / outRate;
    this.jitterSamples = Math.max(0, opts.jitterSamples ?? 0);
  }

  enqueue(itemId: string, contentIndex: number, samples: Float32Array): void {
    if (samples.length === 0) return;
    let it = this.items.get(itemId);
    if (!it) {
      it = { contentIndex, received: 0, played: 0, ended: false };
      this.items.set(itemId, it);
      this.prune();
    }
    it.received += samples.length;
    it.contentIndex = contentIndex;
    this.segs.push({ itemId, samples });
    this.queuedTotal += samples.length;
    this.lastItem = this.lastItem ?? itemId;
  }

  markEnded(itemId: string): void {
    const it = this.items.get(itemId);
    if (it) it.ended = true;
  }

  /** Render `out.length` mono frames. Writes silence when there is nothing to play. */
  process(out: Float32Array): void {
    for (let i = 0; i < out.length; i++) {
      this.outFrames++;
      if (!this.playing) {
        if (this.segs.length === 0 || this.queuedTotal - Math.floor(this.pos) < this.jitterSamples) {
          out[i] = 0;
          this.countUnderrun();
          continue;
        }
        this.playing = true;
        this.everStarted = true;
        this.events.push('started');
      }
      const head = this.segs[0];
      const cur = head.samples;
      const i0 = Math.floor(this.pos);
      const frac = this.pos - i0;
      const a = cur[i0];
      const next = i0 + 1 < cur.length ? cur[i0 + 1] : this.segs[1] ? this.segs[1].samples[0] : a;
      out[i] = a + (next - a) * frac;
      this.pos += this.ratio;
      this.lastItem = head.itemId;
      while (this.segs.length > 0 && this.pos >= this.segs[0].samples.length) {
        const done = this.segs.shift() as Segment;
        const it = this.items.get(done.itemId);
        if (it) it.played += done.samples.length;
        this.pos -= done.samples.length;
        this.queuedTotal -= done.samples.length;
      }
      if (this.segs.length === 0) {
        this.pos = 0;
        this.playing = false;
        const it = this.lastItem ? this.items.get(this.lastItem) : undefined;
        this.events.push(it?.ended ? 'drained' : 'underrun');
      }
    }
  }

  private countUnderrun(): void {
    if (!this.everStarted) return;
    const it = this.lastItem ? this.items.get(this.lastItem) : undefined;
    if (!it?.ended) this.underrunFrames++;
  }

  snapshot(): PlaybackSnapshot {
    const head = this.segs[0];
    const id = head ? head.itemId : this.lastItem;
    const it = id ? this.items.get(id) : undefined;
    const partial = head && id === head.itemId ? this.pos : 0;
    return {
      itemId: id,
      contentIndex: it?.contentIndex ?? 0,
      playedSrc: it ? it.played + partial : 0,
      receivedSrc: it?.received ?? 0,
      ended: it?.ended ?? false,
      underrunFrames: this.underrunFrames,
      queuedSrc: this.queuedTotal - this.pos,
      outFrames: this.outFrames,
    };
  }

  /** Snapshot, then drop everything queued. The next audio starts a fresh turn. */
  clear(): PlaybackSnapshot {
    const snap = this.snapshot();
    this.segs = [];
    this.pos = 0;
    this.queuedTotal = 0;
    this.items.clear();
    this.lastItem = null;
    this.playing = false;
    this.everStarted = false;
    this.underrunFrames = 0;
    this.outFrames = 0;
    this.events = [];
    return snap;
  }

  /** Events since the last call (started, drained, underrun). */
  takeEvents(): PlaybackEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private prune(): void {
    if (this.items.size <= 16) return;
    for (const [id, it] of this.items) {
      if (this.items.size <= 16) break;
      if (it.ended && !this.segs.some((s) => s.itemId === id) && id !== this.lastItem) this.items.delete(id);
    }
  }
}
