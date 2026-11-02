import { getContext } from '../config.js';
import { SECURITY_HEADERS, guard, json, methodNotAllowed } from '../http.js';
import { publicStatus } from '../versions.js';

/** Public, read-only: which version is published and which datasets it holds. No secrets, no store URLs. */
export const GET = guard(async (request) => {
  const ctx = getContext();
  if (!ctx.store) return json({ configured: false, version: null, publishedAt: null }, 200, { 'Cache-Control': 'no-cache', 'Vercel-CDN-Cache-Control': 'max-age=30' });
  const status = await publicStatus(ctx);
  const etag = `"${status.version?.versionId ?? 'none'}"`;
  // browsers must revalidate every time (a stale answer would delay a publish reaching viewers); Vercel's CDN may reuse it for 10 s
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', 'Vercel-CDN-Cache-Control': 'max-age=10, stale-while-revalidate=20' };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...headers, ...SECURITY_HEADERS } });
  return json(status, 200, headers);
});
export const POST = () => methodNotAllowed('GET');
