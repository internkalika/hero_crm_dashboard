// Administrator authentication: a shared secret exchanged for a signed, HttpOnly, time-limited session cookie.
//   * the secret is compared in constant time and never stored, logged or returned
//   * the cookie holds only {session id, issued, expires}, signed with a separate server secret (HMAC-SHA-256)
//   * logout revokes the session id server-side, so a copied cookie stops working
//   * every state-changing admin call needs the cookie AND a custom header AND a same-origin request (CSRF)
//   * failed logins are throttled per client address (persisted in the store, plus a per-instance cache)
import crypto from 'node:crypto';
import { HttpError, clientIp } from './http.js';
import { adminProblems, paths, type Context } from './config.js';

export const COOKIE = 'crm_admin';
export const CSRF_HEADER = 'x-crm-admin';

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest();
const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

export function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

export interface SessionPayload {
  sid: string;
  iat: number;
  exp: number;
}

export function createSessionToken(secret: string, nowMs: number, hours: number): { token: string; payload: SessionPayload } {
  const payload: SessionPayload = { sid: crypto.randomBytes(16).toString('hex'), iat: Math.floor(nowMs / 1000), exp: Math.floor(nowMs / 1000) + Math.round(hours * 3600) };
  const body = b64u(JSON.stringify(payload));
  return { token: `${body}.${b64u(hmac(secret, body))}`, payload };
}

export function verifySessionToken(secret: string, token: string | undefined, nowMs: number): SessionPayload | null {
  if (!token || token.length > 512) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = hmac(secret, body);
  let got: Buffer;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof p.sid !== 'string' || !/^[0-9a-f]{32}$/.test(p.sid) || typeof p.exp !== 'number' || p.exp * 1000 <= nowMs) return null;
    return p;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const isHttps = (request: Request) => new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';

export function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  // Path=/api: the browser sends it to the API only, never with the page or its assets
  return `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isHttps(request) ? '; Secure' : ''}`;
}
export const clearCookie = (request: Request) => sessionCookie(request, '', 0);

/** Same-origin check for state-changing calls: custom header (cannot be sent cross-site without CORS) + Origin/Fetch-Metadata. */
export function assertSameOrigin(request: Request) {
  if (request.headers.get(CSRF_HEADER) !== '1') throw new HttpError(403, 'csrf', 'Missing request header.');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'csrf', 'Cross-site requests are not allowed.');
  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('x-forwarded-host') ?? new URL(request.url).host;
    let oh = '';
    try {
      oh = new URL(origin).host;
    } catch {
      /* falls through to the rejection */
    }
    if (oh !== host) throw new HttpError(403, 'csrf', 'The request does not come from this site.');
  }
}

export function assertAdminConfigured(ctx: Context) {
  const problems = adminProblems(ctx.cfg);
  if (problems.length || !ctx.store) {
    throw new HttpError(503, 'not_configured', 'Publishing is not set up on this deployment.', { missing: [...problems, ...(ctx.store ? [] : ['BLOB_READ_WRITE_TOKEN (a private Blob store)'])] });
  }
}

const throttleMemory = new Map<string, number[]>();
/** Best-effort per-session request throttle (per server instance). */
function throttle(sid: string, nowMs: number) {
  const recent = (throttleMemory.get(sid) ?? []).filter((t) => nowMs - t < 60_000);
  recent.push(nowMs);
  throttleMemory.set(sid, recent);
  if (recent.length > 300) throw new HttpError(429, 'rate_limited', 'Too many requests.', {}, { 'Retry-After': '30' });
}

/** Verifies the admin cookie (and, for non-GET calls, the CSRF rules). Returns the session. */
export async function requireAdmin(ctx: Context, request: Request): Promise<SessionPayload> {
  assertAdminConfigured(ctx);
  if (request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request);
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  const session = verifySessionToken(ctx.cfg.sessionSecret!, token, ctx.now());
  if (!session) throw new HttpError(401, 'unauthorized', 'Sign in as an administrator.');
  if (await ctx.store!.head(paths(ctx.cfg).revoked(session.sid))) throw new HttpError(401, 'unauthorized', 'This session has ended. Sign in again.');
  throttle(session.sid, ctx.now());
  return session;
}

/* ------------------------------ login throttling ------------------------------ */

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
interface RateState {
  fails: number;
  firstAt: number;
  lockedUntil: number;
}
const rateMemory = new Map<string, RateState>();
const rateKey = (request: Request) => crypto.createHash('sha256').update(clientIp(request)).digest('hex').slice(0, 32);

async function loadRate(ctx: Context, key: string): Promise<RateState> {
  const mem = rateMemory.get(key);
  const stored = await ctx.store!.getBytes(paths(ctx.cfg).rate(key)).catch(() => null);
  let disk: RateState | null = null;
  if (stored) {
    try {
      disk = JSON.parse(new TextDecoder().decode(stored.bytes)) as RateState;
    } catch {
      disk = null;
    }
  }
  // the stricter of the two views (another instance may have recorded failures this one has not seen)
  const best = [mem, disk].filter(Boolean).sort((a, b) => b!.fails - a!.fails)[0];
  return best ?? { fails: 0, firstAt: 0, lockedUntil: 0 };
}

async function saveRate(ctx: Context, key: string, s: RateState) {
  rateMemory.set(key, s);
  await ctx.store!.put(paths(ctx.cfg).rate(key), new TextEncoder().encode(JSON.stringify(s)), { contentType: 'application/json', overwrite: true }).catch(() => undefined);
}

export async function assertLoginAllowed(ctx: Context, request: Request) {
  const s = await loadRate(ctx, rateKey(request));
  const now = ctx.now();
  if (s.lockedUntil > now) {
    const wait = Math.ceil((s.lockedUntil - now) / 1000);
    throw new HttpError(429, 'locked', 'Too many failed attempts. Try again later.', { retryAfterSeconds: wait }, { 'Retry-After': String(wait) });
  }
}

export async function recordLoginFailure(ctx: Context, request: Request) {
  const key = rateKey(request);
  const s = await loadRate(ctx, key);
  const now = ctx.now();
  const fresh = now - s.firstAt > LOGIN_WINDOW_MS;
  const next: RateState = fresh ? { fails: 1, firstAt: now, lockedUntil: 0 } : { ...s, fails: s.fails + 1 };
  if (next.fails >= LOGIN_MAX_FAILURES) next.lockedUntil = now + LOGIN_WINDOW_MS;
  await saveRate(ctx, key, next);
}

export async function recordLoginSuccess(ctx: Context, request: Request) {
  await saveRate(ctx, rateKey(request), { fails: 0, firstAt: 0, lockedUntil: 0 });
}

export async function revokeSession(ctx: Context, session: SessionPayload) {
  await ctx.store!.put(paths(ctx.cfg).revoked(session.sid), new TextEncoder().encode(String(session.exp)), { contentType: 'text/plain', overwrite: true });
}

/** tests */
export function resetAuthMemory() {
  throttleMemory.clear();
  rateMemory.clear();
}
