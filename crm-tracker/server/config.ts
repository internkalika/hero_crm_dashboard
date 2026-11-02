// Server configuration, read from environment variables only. Secrets never leave the server: nothing here is
// serialised into a response, a log line or the front-end bundle.
import { FileStore } from './store-file.js';
import type { Store } from './store.js';
import { VercelBlobStore } from './store-vercel.js';

export interface ServerConfig {
  adminSecret: string | null;
  sessionSecret: string | null;
  pepper: string | null;
  /**
   * Prefix of the two Blob variables this deployment reads: `<prefix>_READ_WRITE_TOKEN` and `<prefix>_STORE_ID`
   * (Preview: CRM_PREVIEW). null when CRM_BLOB_VARIABLE_PREFIX is not a CRM_… name.
   * The unprefixed BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID of the project (production's store) are never read.
   */
  blobVarPrefix: string | null;
  blobToken: string | undefined;
  blobStoreId: string | undefined;
  storeDir: string | null;
  prefix: string;
  sessionHours: number;
}

export const MIN_ADMIN_SECRET = 16;
export const MIN_SERVER_SECRET = 32;

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const v = (k: string) => (env[k]?.trim() ? env[k]!.trim() : null);
  const hours = Number(env.CRM_SESSION_HOURS);
  const rawPrefix = (env.CRM_BLOB_VARIABLE_PREFIX ?? 'CRM_PREVIEW').trim();
  // only CRM_… names: a prefix can never resolve to the project's own BLOB_* variables
  const blobVarPrefix = /^CRM_[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(rawPrefix) ? rawPrefix : null;
  return {
    adminSecret: v('CRM_ADMIN_SECRET'),
    sessionSecret: v('CRM_SESSION_SECRET'),
    pepper: v('CRM_PUBLISH_PEPPER'),
    blobVarPrefix,
    blobToken: blobVarPrefix ? v(`${blobVarPrefix}_READ_WRITE_TOKEN`) ?? undefined : undefined,
    blobStoreId: blobVarPrefix ? v(`${blobVarPrefix}_STORE_ID`) ?? undefined : undefined,
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

const normaliseStoreId = (id: string) => id.trim().replace(/^store_/i, '').toLowerCase();
/** The store id the SDK derives from a read-write token (`vercel_blob_rw_<storeId>_<secret>`). */
const tokenStoreId = (token: string) => (/^vercel_blob_rw_([^_]+)_.+$/.exec(token)?.[1] ?? '').toLowerCase();

/** What is missing or wrong for the Blob store (names only: this goes to the server log, never to a response). */
export function blobProblems(c: ServerConfig): string[] {
  if (!c.blobVarPrefix) return ['CRM_BLOB_VARIABLE_PREFIX (must look like CRM_PREVIEW)'];
  const p: string[] = [];
  if (!c.blobToken) p.push(`${c.blobVarPrefix}_READ_WRITE_TOKEN`);
  if (!c.blobStoreId) p.push(`${c.blobVarPrefix}_STORE_ID`);
  if (c.blobToken && !tokenStoreId(c.blobToken)) p.push(`${c.blobVarPrefix}_READ_WRITE_TOKEN (not a read-write token)`);
  if (c.blobToken && c.blobStoreId && tokenStoreId(c.blobToken) && tokenStoreId(c.blobToken) !== normaliseStoreId(c.blobStoreId)) {
    p.push(`${c.blobVarPrefix}_READ_WRITE_TOKEN and ${c.blobVarPrefix}_STORE_ID belong to different stores`);
  }
  return p;
}

/**
 * The directory store (local development, tests) or the private Blob store named by the prefixed variables. A token that
 * does not belong to the declared store is refused, so a production token cannot end up in a Preview by mistake.
 */
export function makeStore(c: ServerConfig): Store | null {
  if (c.storeDir) return new FileStore(c.storeDir);
  if (c.blobToken && blobProblems(c).length === 0) return new VercelBlobStore(c.blobToken);
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
