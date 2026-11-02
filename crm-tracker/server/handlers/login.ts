import { assertAdminConfigured, assertSameOrigin, checkAdminCredentials, createSessionToken, recordLoginSuccess, reserveLoginAttempt, sessionCookie } from '../auth.js';
import { ADMIN_EMAIL, getContext } from '../config.js';
import { HttpError, guard, json, methodNotAllowed, readJson } from '../http.js';

/** The one administrator signs in with the fixed email and CRM_ADMIN_SECRET as the password. Anything else is refused. */
export const POST = guard(async (request) => {
  const ctx = getContext();
  assertAdminConfigured(ctx);
  assertSameOrigin(request);
  await reserveLoginAttempt(ctx, request); // counted first, then checked: a parallel burst cannot out-run the limit
  const body = await readJson<{ email?: unknown; password?: unknown }>(request, 4096).catch((e) => {
    throw e instanceof HttpError ? e : new HttpError(400, 'bad_request', 'Bad request.');
  });
  if (!checkAdminCredentials(ctx.cfg, body.email, body.password)) {
    await new Promise((r) => setTimeout(r, 400)); // slows guessing down a little more
    throw new HttpError(401, 'invalid_credentials', 'That email or password is not correct.'); // never says which
  }
  await recordLoginSuccess(ctx, request);
  const { token, payload } = createSessionToken(ctx.cfg.sessionSecret!, ctx.now(), ctx.cfg.sessionHours);
  return json({ admin: true, email: ADMIN_EMAIL, expiresAt: new Date(payload.exp * 1000).toISOString() }, 200, { 'Set-Cookie': sessionCookie(request, token, payload.exp - payload.iat) });
});
export const GET = () => methodNotAllowed('POST');
