export interface MockServerOptions {
  port?: number; host?: string; protocol?: 'openai' | 'gemini';
  burstMs?: number; stallMs?: number; totalMs?: number; chunkMs?: number;
}
export interface MockServer { port: number; url: string; events: Array<Record<string, unknown>>; close(): Promise<void> }
export function startMockServer(opts?: MockServerOptions): Promise<MockServer>;
