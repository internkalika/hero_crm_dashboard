// How the ingest worker is started. The normal (Netlify) build loads it as a separate file.
// The single-file HTML build swaps this module for spawn.single.ts (see vite.config.ts).
export function spawnIngestWorker(): Worker {
  return new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' });
}
