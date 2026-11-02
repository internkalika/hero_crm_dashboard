// Administrator authentication: a shared secret exchanged for a signed, HttpOnly, time-limited session cookie.
//   * the secret is compared in constant time and never stored, logged or returned
//   * the cookie holds only {session id, issued, expires}, signed with a separate server secret (HMAC-SHA-256)
//   * logout revokes the session id server-side, so a copied cookie stops working
//   * every state-changing admin call needs the cookie AND a custom header AND a same-origin request (CSRF)
//   * failed logins are throttled per client address (persisted in the store, plus a per-instance cache)
import crypto from 'node:crypto';
import { HttpError, clientIp } from './http.js';
import { PreconditionFailed } from './store.js';
import { ADMIN_EMAIL, adminProblems, blobProblems, paths, type ServerConfig, type Context } from './config.js';

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
  /** the account the session belongs to: always the one administrator */
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Both the email and the password must match, each compared in constant time and both always evaluated, so neither the time taken
 * nor the failure message says which of the two was wrong. The email must match exactly (no case folding, no trimming).
 */
export function checkAdminCredentials(cfg: Pick<ServerConfig, 'adminSecret'>, email: unknown, password: unknown): boolean {
  const emailOk = typeof email === 'string' && email.length <= 320 && safeEqual(email, ADMIN_EMAIL);
  const passwordOk = typeof password === 'string' && password.length > 0 && password.length <= 512 && !!cfg.adminSecret && safeEqual(password, cfg.adminSecret);
  return emailOk && passwordOk;
}

export function createSessionToken(secret: string, nowMs: number, hours: number): { token: string; payload: SessionPayload } {
  const payload: SessionPayload = { sid: crypto.randomBytes(16).toString('hex'), sub: ADMIN_EMAIL, iat: Math.floor(nowMs / 1000), exp: Math.floor(nowMs / 1000) + Math.round(hours * 3600) };
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
    if (p.sub !== ADMIN_EMAIL) return null; // a token that is not for the administrator (or predates this field) is worth nothing
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

function configProblems(ctx: Context): string[] {
  return [...adminProblems(ctx.cfg), ...(ctx.store ? [] : blobProblems(ctx.cfg))];
}

/** Sign-in on a deployment that is not set up says so (it is not a data operation). */
export function assertAdminConfigured(ctx: Context) {
  const problems = configProblems(ctx);
  if (problems.length) {
    console.warn('[crm-api] publishing is not configured; missing:', problems.join('; ')); // names only, in the server log
    throw new HttpError(503, 'not_configured', 'Publishing is not set up on this deployment.');
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
  // A deployment that is not set up has no administrator: every protected call is simply "not signed in" (401), whoever asks,
  // and the public learns nothing about the configuration (the missing names go to the server log).
  const problems = configProblems(ctx);
  if (problems.length) {
    console.warn('[crm-api] protected call refused, publishing is not configured; missing:', problems.join('; '));
    throw new HttpError(401, 'unauthorized', 'Sign in as the administrator.');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') assertSameOrigin(request);
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  const session = verifySessionToken(ctx.cfg.sessionSecret!, token, ctx.now());
  if (!session) throw new HttpError(401, 'unauthorized', 'Sign in as the administrator.');
  if (await ctx.store!.head(paths(ctx.cfg).revoked(session.sid))) throw new HttpError(401, 'unauthorized', 'This session has ended. Sign in again.');
  throttle(session.sid, ctx.now());
  return session;
}

/* ------------------------------ login throttling ------------------------------ */

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
interface RateState {
  count: number;
  firstAt: number;
  lockedUntil: number;
}
const rateKey = (request: Request) => crypto.createHash('sha256').update(clientIp(request)).digest('hex').slice(0, 32);
const locked = (s: RateState, now: number) => {
  const wait = Math.max(1, Math.ceil((s.lockedUntil - now) / 1000));
  return new HttpError(429, 'locked', 'Too many failed attempts. Try again later.', { retryAfterSeconds: wait }, { 'Retry-After': String(wait) });
};
const unavailable = () => new HttpError(503, 'unavailable', 'Sign-in is temporarily unavailable. Try again shortly.');

/**
 * Counts a sign-in attempt BEFORE the secret is looked at, with a compare-and-swap on the stored counter, so a burst of
 * parallel guesses is counted one by one and only the first few are ever checked. A successful sign-in resets the count.
 * If the counter cannot be read or written the attempt is refused (the throttle fails closed).
 */
export async function reserveLoginAttempt(ctx: Context, request: Request): Promise<void> {
  const path = paths(ctx.cfg).rate(rateKey(request));
  for (let i = 0; i < 8; i++) {
    let cur: Awaited<ReturnType<NonNullable<Context['store']>['getBytes']>>;
    try {
      cur = await ctx.store!.getBytes(path);
    } catch {
      throw unavailable();
    }
    const now = ctx.now();
    let s: RateState = { count: 0, firstAt: 0, lockedUntil: 0 };
    if (cur) {
      try {
        s = JSON.parse(new TextDecoder().decode(cur.bytes)) as RateState;
      } catch {
        s = { count: 0, firstAt: 0, lockedUntil: 0 };
      }
    }
    if (s.lockedUntil > now) throw locked(s, now);
    if (now - s.firstAt > LOGIN_WINDOW_MS) s = { count: 0, firstAt: now, lockedUntil: 0 };
    s.count += 1;
    if (s.count > LOGIN_MAX_ATTEMPTS) s.lockedUntil = now + LOGIN_WINDOW_MS;
    try {
      await ctx.store!.put(path, new TextEncoder().encode(JSON.stringify(s)), cur ? { contentType: 'application/json', ifMatch: cur.etag } : { contentType: 'application/json', ifNotExists: true });
    } catch (e) {
      if (e instanceof PreconditionFailed) continue; // another attempt was counted at the same moment: count again on top of it
      throw unavailable();
    }
    if (s.lockedUntil > now) throw locked(s, now);
    return;
  }
  throw new HttpError(429, 'busy', 'Too many attempts at once. Try again shortly.', {}, { 'Retry-After': '5' });
}

export async function recordLoginSuccess(ctx: Context, request: Request) {
  await ctx.store!.put(paths(ctx.cfg).rate(rateKey(request)), new TextEncoder().encode(JSON.stringify({ count: 0, firstAt: 0, lockedUntil: 0 })), { contentType: 'application/json', overwrite: true }).catch(() => undefined);
}

export async function revokeSession(ctx: Context, session: SessionPayload) {
  await ctx.store!.put(paths(ctx.cfg).revoked(session.sid), new TextEncoder().encode(String(session.exp)), { contentType: 'text/plain', overwrite: true });
}

/** tests */
export function resetAuthMemory() {
  throttleMemory.clear();
}
