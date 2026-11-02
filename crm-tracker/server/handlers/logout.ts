import { COOKIE, assertSameOrigin, clearCookie, parseCookies, revokeSession, verifySessionToken } from '../auth.js';
import { adminProblems, getContext } from '../config.js';
import { guard, json, methodNotAllowed } from '../http.js';

export const POST = guard(async (request) => {
  const ctx = getContext();
  assertSameOrigin(request);
  // best effort and always ends in a cleared cookie: a missing/expired/forged cookie is simply "already signed out"
  if (ctx.store && !adminProblems(ctx.cfg).length) {
    const s = verifySessionToken(ctx.cfg.sessionSecret!, parseCookies(request.headers.get('cookie'))[COOKIE], ctx.now());
    if (s) await revokeSession(ctx, s);
  }
  return json({ admin: false }, 200, { 'Set-Cookie': clearCookie(request) });
});
export const GET = () => methodNotAllowed('POST');
