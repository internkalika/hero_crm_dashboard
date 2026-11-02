export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
  toResponse() {
    return json({ error: this.code, message: this.message, ...this.extra }, this.status, this.headers);
  }
}

export const methodNotAllowed = (allow: string) => new HttpError(405, 'method_not_allowed', 'Method not allowed.', {}, { Allow: allow }).toResponse();

/** Wraps a handler: HttpError becomes its response, anything else a generic 500 (details only in the server log). */
export function guard(fn: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await fn(request);
    } catch (e) {
      if (e instanceof HttpError) return e.toResponse();
      console.error('[crm-api] unexpected error', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
      return json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500);
    }
  };
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function readJson<T = unknown>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(413, 'too_large', 'The request body is too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'The request body is too large.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
  }
}
