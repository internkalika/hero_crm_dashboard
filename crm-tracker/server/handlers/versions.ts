import { requireAdmin } from '../auth.js';
import { getContext } from '../config.js';
import { guard, json } from '../http.js';
import { listVersions, readCurrent, readManifest } from '../versions.js';

/** Version history, newest first. With ?id=… the full manifest (what changed in that version). */
export const GET = guard(async (request) => {
  const ctx = getContext();
  await requireAdmin(ctx, request);
  const id = new URL(request.url).searchParams.get('id');
  if (id) return json({ manifest: await readManifest(ctx, id) });
  return json({ current: (await readCurrent(ctx))?.pointer.versionId ?? null, versions: await listVersions(ctx) });
});
