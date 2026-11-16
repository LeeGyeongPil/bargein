export interface ScenarioResult {
  wallMs: number;
  playedMs: number;
  receivedMs: number;
  sentAudioEndMs: number;
  wallClockAudioEndMs: number;
  unclampedAudioEndMs: number;
  sent: Array<Record<string, unknown>>;
  replies: Array<Record<string, any>>;
}
export function runBargeInScenario(deps: Record<string, any>): Promise<ScenarioResult>;
