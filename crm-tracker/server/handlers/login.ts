import { assertAdminConfigured, assertLoginAllowed, assertSameOrigin, createSessionToken, recordLoginFailure, recordLoginSuccess, safeEqual, sessionCookie } from '../auth.js';
import { getContext } from '../config.js';
import { HttpError, guard, json, methodNotAllowed, readJson } from '../http.js';

export const POST = guard(async (request) => {
  const ctx = getContext();
  assertAdminConfigured(ctx);
  assertSameOrigin(request);
  await assertLoginAllowed(ctx, request);
  const body = await readJson<{ secret?: unknown }>(request, 4096).catch((e) => {
    throw e instanceof HttpError ? e : new HttpError(400, 'bad_request', 'Bad request.');
  });
  const given = typeof body.secret === 'string' ? body.secret : '';
  if (!given || given.length > 512 || !safeEqual(given, ctx.cfg.adminSecret!)) {
    await recordLoginFailure(ctx, request);
    await new Promise((r) => setTimeout(r, 400)); // slows guessing down a little more
    throw new HttpError(401, 'invalid_credentials', 'That secret is not correct.');
  }
  await recordLoginSuccess(ctx, request);
  const { token, payload } = createSessionToken(ctx.cfg.sessionSecret!, ctx.now(), ctx.cfg.sessionHours);
  return json({ admin: true, expiresAt: new Date(payload.exp * 1000).toISOString() }, 200, { 'Set-Cookie': sessionCookie(request, token, payload.exp - payload.iat) });
});
export const GET = () => methodNotAllowed('POST');
