// Who is looking at the dashboard: the one administrator, or everybody else.
//
// The dashboards are public. The data tools (Data Import with its worksheet choice, validation and replace / merge / skip, and Data
// Management with publishing, version history and restore) are for the administrator only. The server enforces that for everything
// that touches shared data (every /api/admin/* call is refused without the administrator's session); this module decides what the
// screen offers, so a visitor sees a sign-in form instead of tools that would only fail.
//
// Hosts without a backend (the single HTML file, a static host) have no administrator to ask. There the import stays what it has always
// been: a private, local tool of whoever opened the file, and nothing shared exists to protect.
import { ApiError } from './api';

export type AdminState =
  | { phase: 'loading' }
  /** the single HTML file: nothing shared exists, local import stays open as it always has */
  | { phase: 'no-backend' }
  /** a backend is expected but could not be asked: the tools stay closed */
  | { phase: 'unavailable' }
  | { phase: 'public'; configured: boolean }
  | { phase: 'admin'; email: string; expiresAt: string | null };

export interface SessionAnswer {
  configured?: unknown;
  admin?: unknown;
  expiresAt?: unknown;
  email?: unknown;
}

/** Turns what /api/admin/session answered (or the way it failed) into a state. Pure, so it can be tested without a browser. */
export function stateFromSessionResponse(r: { ok: boolean; status: number; json: boolean; body?: SessionAnswer } | { networkError: true }): AdminState {
  if ('networkError' in r) return { phase: 'unavailable' };
  // A deployed copy whose API does not answer is NOT treated as "no backend": the data tools stay closed (fail closed).
  // Only the single-file copy (probeAdmin's singleFile option) has no administrator by design.
  if (!r.ok || !r.json || !r.body) return { phase: 'unavailable' };
  if (r.body.admin === true && typeof r.body.email === 'string') return { phase: 'admin', email: r.body.email, expiresAt: typeof r.body.expiresAt === 'string' ? r.body.expiresAt : null };
  return { phase: 'public', configured: r.body.configured === true };
}

export async function probeAdmin(opts: { singleFile?: boolean } = {}): Promise<AdminState> {
  if (opts.singleFile) return { phase: 'no-backend' };
  try {
    const res = await fetch('/api/admin/session', { cache: 'no-store', credentials: 'same-origin' });
    const json = (res.headers.get('content-type') ?? '').includes('json');
    return stateFromSessionResponse({ ok: res.ok, status: res.status, json, body: json ? ((await res.json().catch(() => undefined)) as SessionAnswer | undefined) : undefined });
  } catch {
    return stateFromSessionResponse({ networkError: true });
  }
}

/** May this visitor use the import tools? Only the administrator, or anyone where there is no backend to hold a shared dataset. */
export const mayUseDataTools = (s: AdminState): boolean => s.phase === 'admin' || s.phase === 'no-backend';

/** Message for a failed sign-in, never saying which of the two fields was wrong. */
export function loginErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'locked' && e.retryAfterSeconds) return `Too many failed attempts. Try again in ${Math.ceil(e.retryAfterSeconds / 60)} minute${e.retryAfterSeconds > 90 ? 's' : ''}.`;
    if (e.code === 'invalid_credentials') return 'That email or password is not correct.';
    if (e.code === 'not_configured') return 'Sign-in is not available on this deployment yet.';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
