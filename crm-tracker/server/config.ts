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
   * The Vercel Blob store connected to the project (Vercel creates BLOB_STORE_ID when a store is connected). The server
   * authenticates to it with the short-lived OIDC token Vercel gives every function invocation: no token is stored anywhere.
   */
  blobStoreId: string | undefined;
  /** stores this deployment must never use (the test store), from CRM_BLOCKED_BLOB_STORE_IDS and the leftover CRM_PREVIEW_STORE_ID */
  blockedStoreIds: string[];
  storeDir: string | null;
  prefix: string;
  sessionHours: number;
}

/** `store_abc` and `abc` name the same store; ids are compared in lower case */
export function normaliseStoreId(id: string): string {
  return id.trim().replace(/^store_/i, '').toLowerCase();
}

export const MIN_ADMIN_SECRET = 16;
export const MIN_SERVER_SECRET = 32;

export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const v = (k: string) => (env[k]?.trim() ? env[k]!.trim() : null);
  const hours = Number(env.CRM_SESSION_HOURS);
  const vercelEnv = /^[a-z]{1,20}$/.test(env.VERCEL_ENV?.trim() ?? '') ? env.VERCEL_ENV!.trim() : null;
  const blocked = [env.CRM_BLOCKED_BLOB_STORE_IDS ?? '', env.CRM_PREVIEW_STORE_ID ?? ''].join(',').split(',').map((s) => normaliseStoreId(s)).filter(Boolean);
  return {
    adminSecret: v('CRM_ADMIN_SECRET'),
    sessionSecret: v('CRM_SESSION_SECRET'),
    pepper: v('CRM_PUBLISH_PEPPER'),
    blobStoreId: v('BLOB_STORE_ID') ?? undefined,
    blockedStoreIds: [...new Set(blocked)],
    storeDir: v('CRM_STORE_DIR'),
    // Preview and Production share one store, so each gets its own folder in it: a test publish on a Preview can never touch live data
    prefix: (v('CRM_BLOB_PREFIX') ?? (vercelEnv ? `crm-tracker/${vercelEnv}` : 'crm-tracker')).replace(/^\/+|\/+$/g, ''),
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

/** What is missing or wrong for the Blob store (names only: this goes to the server log, never to a response). */
export function blobProblems(c: ServerConfig): string[] {
  const p: string[] = [];
  if (!c.blobStoreId) p.push('BLOB_STORE_ID (connect the Blob store to this project and environment)');
  else if (c.blockedStoreIds.includes(normaliseStoreId(c.blobStoreId))) p.push('BLOB_STORE_ID is a store this deployment must not use (the test store)');
  return p;
}

/**
 * The directory store (local development, tests) or the connected private Blob store, reached with Vercel's OIDC token.
 * A store listed as blocked is refused, so the test store cannot be used for the real dashboard by mistake.
 */
export function makeStore(c: ServerConfig): Store | null {
  if (c.storeDir) return new FileStore(c.storeDir);
  if (c.blobStoreId && blobProblems(c).length === 0) return new VercelBlobStore({ storeId: c.blobStoreId });
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
