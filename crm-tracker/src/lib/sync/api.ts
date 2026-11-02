// Calls to the CRM Tracker API (same origin). Admin calls send the CSRF header and rely on the HttpOnly session
// cookie; the browser never sees the admin secret after the sign-in request and cannot read the cookie.
import type { DatasetChange, SnapshotStatus, VersionManifest, VersionSummary } from '../publish/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get retryAfterSeconds(): number | null {
    return typeof this.data.retryAfterSeconds === 'number' ? this.data.retryAfterSeconds : null;
  }
}

const ADMIN = { 'X-CRM-Admin': '1' };

async function call<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { ...(admin ? ADMIN : {}), ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? 'error'), String(body.message ?? `The server answered ${res.status}.`), body);
  return body as T;
}
const post = <T,>(path: string, body: unknown, admin = true) => call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, admin);

/**
 * The single-file HTML is meant to be shared as a file or from any static host: it never talks to a backend.
 * Every other build does, so a host that turns out to have no API (404, or the page itself answering) is asked only once.
 */
export const syncEnabled = (): boolean => import.meta.env.MODE !== 'single' && !backendMissing;
let backendMissing = false;
export const resetBackendProbe = () => { backendMissing = false; };

/** Public: which version is published. Resolves to null when the API cannot be reached (offline, no backend, a static copy). */
export async function fetchStatus(): Promise<SnapshotStatus | null> {
  if (!syncEnabled()) return null;
  try {
    const res = await fetch('/api/snapshot', { cache: 'no-cache', credentials: 'omit' });
    const json = (res.headers.get('content-type') ?? '').includes('json');
    if (res.status === 404 || res.status === 405 || (res.ok && !json)) backendMissing = true; // a static host, or a single-page fallback answering for /api
    if (!res.ok || !json) return null;
    return (await res.json()) as SnapshotStatus;
  } catch {
    return null;
  }
}

export async function fetchDatasetBytes(sha: string): Promise<Uint8Array> {
  const res = await fetch(`/api/dataset?sha=${encodeURIComponent(sha)}`, { credentials: 'omit' });
  if (!res.ok) throw new ApiError(res.status, 'dataset', `The published dataset could not be downloaded (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface AdminSession {
  configured: boolean;
  admin: boolean;
  expiresAt: string | null;
  /** the administrator's email, given only to the administrator */
  email?: string;
}
export const adminSession = () => call<AdminSession>('/api/admin/session');
/** The one administrator signs in with the fixed email address and the administrator password. */
export const adminLogin = (email: string, password: string) => post<{ admin: true; email: string; expiresAt: string }>('/api/admin/login', { email, password });
export const adminLogout = () => post<{ admin: false }>('/api/admin/logout', {});
export const adminVersions = () => call<{ current: string | null; versions: VersionSummary[] }>('/api/admin/versions', {}, true);
export const adminManifest = (id: string) => call<{ manifest: VersionManifest | null }>(`/api/admin/versions?id=${encodeURIComponent(id)}`, {}, true);

export async function stagePart(upload: string, part: number, bytes: Uint8Array): Promise<void> {
  await call(`/api/admin/stage?upload=${upload}&part=${part}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes as BodyInit }, true);
}

export interface PublishBody {
  baseVersion: string | null;
  note?: string;
  datasets: Array<{ id: string; upload: string; parts: number; sha256: string }>;
  remove?: string[];
}
export interface PublishOutcome {
  unchanged: boolean;
  versionId: string | null;
  createdAt: string | null;
  changes: DatasetChange[];
}
export const adminPublish = (body: PublishBody) => post<PublishOutcome>('/api/admin/publish', body);
export const adminRollback = (toVersion: string, baseVersion: string, note?: string) => post<PublishOutcome>('/api/admin/rollback', { toVersion, baseVersion, note });
