import { COOKIE, parseCookies, verifySessionToken } from '../auth.js';
import { adminProblems, getContext, paths } from '../config.js';
import { guard, json } from '../http.js';

/** Who am I? Never fails: the page uses it to decide whether to show the sign-in form or the admin tools. */
export const GET = guard(async (request) => {
  const ctx = getContext();
  const problems = adminProblems(ctx.cfg);
  const configured = problems.length === 0 && !!ctx.store;
  let admin = false;
  let expiresAt: string | null = null;
  if (configured) {
    const s = verifySessionToken(ctx.cfg.sessionSecret!, parseCookies(request.headers.get('cookie'))[COOKIE], ctx.now());
    if (s && !(await ctx.store!.head(paths(ctx.cfg).revoked(s.sid)))) {
      admin = true;
      expiresAt = new Date(s.exp * 1000).toISOString();
    }
  }
  return json({ configured, admin, expiresAt });
});
