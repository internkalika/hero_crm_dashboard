// Single-file HTML build: the worker code is embedded in the page and started from a blob,
// which also works when the page is opened straight from disk (file://).
import IngestWorker from './ingest.worker?worker&inline';

export function spawnIngestWorker(): Worker {
  return new IngestWorker();
}
