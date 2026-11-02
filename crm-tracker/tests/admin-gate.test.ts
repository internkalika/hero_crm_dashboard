import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginErrorMessage, mayUseDataTools, probeAdmin, stateFromSessionResponse } from '../src/lib/sync/admin';
import { ApiError } from '../src/lib/sync/api';

const ADMIN = 'intern.kalika@herocycles.com';
afterEach(() => vi.unstubAllGlobals());

describe('who may see the data tools', () => {
  it('a public visitor does not', () => {
    const s = stateFromSessionResponse({ ok: true, status: 200, json: true, body: { configured: true, admin: false } });
    expect(s).toEqual({ phase: 'public', configured: true });
    expect(mayUseDataTools(s)).toBe(false);
  });
  it('the administrator does', () => {
    const s = stateFromSessionResponse({ ok: true, status: 200, json: true, body: { configured: true, admin: true, email: ADMIN, expiresAt: '2026-11-02T18:00:00Z' } });
    expect(s).toMatchObject({ phase: 'admin', email: ADMIN });
    expect(mayUseDataTools(s)).toBe(true);
  });
  it('an admin claim without an email is not trusted', () => {
    expect(mayUseDataTools(stateFromSessionResponse({ ok: true, status: 200, json: true, body: { admin: true } }))).toBe(false);
  });
  it('fails closed on a missing API, an error, a network failure or a non-JSON answer', () => {
    for (const r of [
      { ok: false, status: 404, json: false },
      { ok: false, status: 500, json: true, body: {} },
      { ok: true, status: 200, json: false },
      { networkError: true as const },
    ]) expect(mayUseDataTools(stateFromSessionResponse(r))).toBe(false);
  });
  it('the single HTML file keeps its local import, without asking the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const s = await probeAdmin({ singleFile: true });
    expect(mayUseDataTools(s)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
  it('probeAdmin reads the server session and never trusts anything else', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ configured: true, admin: false }), { headers: { 'content-type': 'application/json' } })));
    expect(await probeAdmin()).toEqual({ phase: 'public', configured: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(mayUseDataTools(await probeAdmin())).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })));
    expect(mayUseDataTools(await probeAdmin())).toBe(false);
  });
  it('sign-in errors never say which field was wrong', () => {
    const m = loginErrorMessage(new ApiError(401, 'invalid_credentials', 'x'));
    expect(m).toBe('That email or password is not correct.');
    expect(m).not.toMatch(/only|admin@|secret/i);
  });
});
