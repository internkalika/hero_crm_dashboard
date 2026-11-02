import { getContext } from '../config.js';
import { SECURITY_HEADERS, HttpError, guard } from '../http.js';
import { assertServable, datasetStream } from '../versions.js';

/** Public, read-only: one sanitized dataset of the current version, by content address. Streams from the private store. */
export const GET = guard(async (request) => {
  const ctx = getContext();
  if (!ctx.store) throw new HttpError(404, 'not_found', 'No published data.');
  const sha = new URL(request.url).searchParams.get('sha') ?? '';
  // Rolled-back data must stop being served at once, so nothing is cached for long: the browser revalidates every time
  // (a cheap 304 while the dataset is still published) and Vercel's CDN keeps a copy for a minute at most.
  const cacheHeaders = { ETag: `"${sha}"`, 'Cache-Control': 'no-cache', 'Vercel-CDN-Cache-Control': 'max-age=60' };
  await assertServable(ctx, sha);
  if (request.headers.get('if-none-match') === `"${sha}"`) return new Response(null, { status: 304, headers: { ...cacheHeaders, ...SECURITY_HEADERS } });
  const o = await datasetStream(ctx, sha);
  return new Response(o.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(o.size),
      ...cacheHeaders,
      ...SECURITY_HEADERS,
    },
  });
});
