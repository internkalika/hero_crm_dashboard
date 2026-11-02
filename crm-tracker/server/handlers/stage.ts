import { requireAdmin } from '../auth.js';
import { getContext } from '../config.js';
import { HttpError, guard, json, methodNotAllowed } from '../http.js';
import { MAX_PART_BYTES, stagePart } from '../versions.js';

/** Receives one chunk (up to ~3.5 MB, below the platform's 4.5 MB request limit) of a gzipped dataset. */
export const POST = guard(async (request) => {
  const ctx = getContext();
  await requireAdmin(ctx, request);
  const url = new URL(request.url);
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > MAX_PART_BYTES) throw new HttpError(413, 'too_large', 'The part is too large.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  await stagePart(ctx, url.searchParams.get('upload') ?? '', Number(url.searchParams.get('part')), bytes);
  return json({ ok: true });
});
export const GET = () => methodNotAllowed('POST');
