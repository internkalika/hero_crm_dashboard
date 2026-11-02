import { requireAdmin } from '../auth.js';
import { deny } from './denied.js';
import { getContext } from '../config.js';
import { HttpError, guard, json, readJson } from '../http.js';
import { rollback } from '../versions.js';

export const POST = guard(async (request) => {
  const ctx = getContext();
  await requireAdmin(ctx, request);
  const b = await readJson<{ toVersion?: unknown; baseVersion?: unknown; note?: unknown }>(request, 4096);
  if (typeof b.toVersion !== 'string' || typeof b.baseVersion !== 'string') throw new HttpError(400, 'bad_request', 'toVersion and baseVersion are required.');
  return json(await rollback(ctx, { toVersion: b.toVersion, baseVersion: b.baseVersion, note: typeof b.note === 'string' ? b.note : undefined }));
});
export const GET = deny('POST');
export const PUT = deny('POST');
export const PATCH = deny('POST');
export const DELETE = deny('POST');
