// npm run demo: practice mock WebSocket server + Vite dev server for the demo page.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer } from '../mock/server.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const mock = await startMockServer();
const vite = await createServer({ root, server: { host: '127.0.0.1', open: false } });
await vite.listen();
console.log(`practice mock server (not the real service): ${mock.url}`);
vite.printUrls();
console.log('Open the page, click Connect, then Start response and Interrupt. Add ?lang=ko for Korean.');

const stop = async () => { await vite.close(); await mock.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
