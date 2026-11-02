import { requireAdmin } from '../auth.js';
import { getContext } from '../config.js';
import { HttpError, guard } from '../http.js';

/**
 * The answer to any HTTP method an admin endpoint does not offer (PUT, PATCH, DELETE …). Authorization comes first: the public gets
 * 401 (or 403 when the request fails the same-origin rules) and learns nothing else; only the signed-in administrator is told 405.
 */
export const deny = (allow: string) =>
  guard(async (request) => {
    await requireAdmin(getContext(), request);
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed.', {}, { Allow: allow });
  });
