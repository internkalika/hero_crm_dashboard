import { requireAdmin } from '../auth.js';
import { getContext } from '../config.js';
import { guard, json, methodNotAllowed, readJson } from '../http.js';
import { publish, type PublishRequest } from '../versions.js';

export const POST = guard(async (request) => {
  const ctx = getContext();
  await requireAdmin(ctx, request);
  const body = await readJson<PublishRequest>(request, 32 * 1024);
  return json(await publish(ctx, body));
});
export const GET = () => methodNotAllowed('POST');
