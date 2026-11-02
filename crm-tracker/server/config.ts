// Server configuration, read from environment variables only. Secrets never leave the server: nothing here is
// serialised into a response, a log line or the front-end bundle.
import { FileStore } from './store-file.js';
import type { Store } from './store.js';
import { VercelBlobStore } from './store-vercel.js';

export interface ServerConfig {
  adminSecret: string | null;
  sessionSecret: string | null;
  pepper: string | null;
  blobToken: string | undefined;
  storeDir: string | null;
  prefix: string;
  sessionHours: number;
}

export const MIN_ADMIN_SECRET = 16;
export const MIN_SERVER_SECRET = 32;

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const v = (k: string) => (env[k]?.trim() ? env[k]!.trim() : null);
  const hours = Number(env.CRM_SESSION_HOURS);
  return {
    adminSecret: v('CRM_ADMIN_SECRET'),
    sessionSecret: v('CRM_SESSION_SECRET'),
    pepper: v('CRM_PUBLISH_PEPPER'),
    blobToken: v('BLOB_READ_WRITE_TOKEN') ?? undefined,
    storeDir: v('CRM_STORE_DIR'),
    prefix: (v('CRM_BLOB_PREFIX') ?? 'crm-tracker').replace(/^\/+|\/+$/g, ''),
    sessionHours: Number.isFinite(hours) && hours > 0 && hours <= 72 ? hours : 8,
  };
}

/** What is missing for the admin side to work (names only, never values). */
export function adminProblems(c: ServerConfig): string[] {
  const p: string[] = [];
  if (!c.adminSecret || c.adminSecret.length < MIN_ADMIN_SECRET) p.push(`CRM_ADMIN_SECRET (at least ${MIN_ADMIN_SECRET} characters)`);
  if (!c.sessionSecret || c.sessionSecret.length < MIN_SERVER_SECRET) p.push(`CRM_SESSION_SECRET (at least ${MIN_SERVER_SECRET} characters)`);
  if (!c.pepper || c.pepper.length < MIN_SERVER_SECRET) p.push(`CRM_PUBLISH_PEPPER (at least ${MIN_SERVER_SECRET} characters)`);
  return p;
}

export function makeStore(c: ServerConfig): Store | null {
  if (c.storeDir) return new FileStore(c.storeDir);
  if (c.blobToken) return new VercelBlobStore(c.blobToken);
  return null;
}

export interface Context {
  cfg: ServerConfig;
  store: Store | null;
  now: () => number;
}

let cached: Context | null = null;
export function getContext(): Context {
  if (!cached) {
    const cfg = readConfig();
    cached = { cfg, store: makeStore(cfg), now: () => Date.now() };
  }
  return cached;
}
/** tests */
export function setContext(c: Context | null) {
  cached = c;
}

export const paths = (c: ServerConfig) => ({
  current: `${c.prefix}/current.json`,
  versionsPrefix: `${c.prefix}/versions/`,
  manifest: (versionId: string) => `${c.prefix}/versions/${versionId}/manifest.json`,
  dataset: (sha: string) => `${c.prefix}/datasets/${sha}.json.gz`,
  stagingPrefix: `${c.prefix}/staging/`,
  staging: (upload: string, part: number) => `${c.prefix}/staging/${upload}/${part}`,
  revoked: (sid: string) => `${c.prefix}/security/revoked/${sid}`,
  rate: (key: string) => `${c.prefix}/security/ratelimit/${key}.json`,
});
