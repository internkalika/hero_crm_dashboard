import { getContext } from '../config.js';
import { SECURITY_HEADERS, HttpError, guard } from '../http.js';
import { datasetStream } from '../versions.js';

/** Public, read-only: one sanitized dataset of the current version, by content address. Streams from the private store. */
export const GET = guard(async (request) => {
  const ctx = getContext();
  if (!ctx.store) throw new HttpError(404, 'not_found', 'No published data.');
  const o = await datasetStream(ctx, new URL(request.url).searchParams.get('sha') ?? '');
  return new Response(o.stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(o.size),
      // content-addressed: the bytes behind this URL never change
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...SECURITY_HEADERS,
    },
  });
});
