import { guard, json } from '../http.js';

/**
 * Liveness check: proves the functions are deployed and tells which build answers. Public and read-only; it contains no
 * configuration, no secrets and no store information. `commit` and `environment` come from Vercel's own system variables
 * (null when the platform does not provide them, e.g. locally).
 */
export const GET = guard(async () => {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  const env = process.env.VERCEL_ENV?.trim();
  return json({ ok: true, service: 'crm-tracker-api', commit: sha ? sha.slice(0, 7) : null, environment: env && /^[a-z]{1,20}$/.test(env) ? env : null });
});
