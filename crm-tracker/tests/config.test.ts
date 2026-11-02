// Which Blob credentials a deployment uses. Preview reads CRM_PREVIEW_READ_WRITE_TOKEN and CRM_PREVIEW_STORE_ID, and nothing
// else: the project's own BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID (production's store) must never be picked up.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blobProblems, makeStore, readConfig } from '../server/config.js';

const PREVIEW_TOKEN = 'vercel_blob_rw_abcPREVIEW123_secretPart456';
const PROD_TOKEN = 'vercel_blob_rw_xyzPRODUCTION9_prodSecret789';
const PREVIEW = { CRM_PREVIEW_READ_WRITE_TOKEN: PREVIEW_TOKEN, CRM_PREVIEW_STORE_ID: 'store_abcPREVIEW123', CRM_PREVIEW_WEBHOOK_PUBLIC_KEY: 'unused' };
const PRODUCTION = { BLOB_READ_WRITE_TOKEN: PROD_TOKEN, BLOB_STORE_ID: 'store_xyzPRODUCTION9' };

describe('Blob credentials', () => {
  it('Preview uses the CRM_PREVIEW_ token and store id, and builds the Blob store', () => {
    const cfg = readConfig({ ...PREVIEW });
    expect(cfg).toMatchObject({ blobVarPrefix: 'CRM_PREVIEW', blobToken: PREVIEW_TOKEN, blobStoreId: 'store_abcPREVIEW123' });
    expect(blobProblems(cfg)).toEqual([]);
    expect(makeStore(cfg)?.kind).toBe('vercel-blob');
  });
  it('never falls back to the project\'s BLOB_ variables, even when they are present', () => {
    const cfg = readConfig({ ...PRODUCTION, VERCEL_OIDC_TOKEN: 'oidc' });
    expect(cfg.blobToken).toBeUndefined();
    expect(cfg.blobStoreId).toBeUndefined();
    expect(makeStore(cfg)).toBeNull(); // not configured: nothing is read or written
    expect(blobProblems(cfg)).toEqual(['CRM_PREVIEW_READ_WRITE_TOKEN', 'CRM_PREVIEW_STORE_ID']);
  });
  it('uses the Preview credentials when both sets are present', () => {
    const cfg = readConfig({ ...PREVIEW, ...PRODUCTION });
    expect(cfg.blobToken).toBe(PREVIEW_TOKEN);
    expect(JSON.stringify(cfg)).not.toContain(PROD_TOKEN);
    expect(makeStore(cfg)?.kind).toBe('vercel-blob');
  });
  it('does not fall back to the production token when only the Preview token is missing', () => {
    const cfg = readConfig({ CRM_PREVIEW_STORE_ID: PREVIEW.CRM_PREVIEW_STORE_ID, ...PRODUCTION });
    expect(makeStore(cfg)).toBeNull();
    expect(blobProblems(cfg)).toEqual(['CRM_PREVIEW_READ_WRITE_TOKEN']);
  });
  it('refuses a token that belongs to a different store than CRM_PREVIEW_STORE_ID', () => {
    const cfg = readConfig({ CRM_PREVIEW_READ_WRITE_TOKEN: PROD_TOKEN, CRM_PREVIEW_STORE_ID: PREVIEW.CRM_PREVIEW_STORE_ID });
    expect(makeStore(cfg)).toBeNull();
    expect(blobProblems(cfg)).toEqual(['CRM_PREVIEW_READ_WRITE_TOKEN and CRM_PREVIEW_STORE_ID belong to different stores']);
  });
  it('accepts the store id with or without its store_ prefix, in any case', () => {
    for (const id of ['abcPREVIEW123', 'store_abcPREVIEW123', 'ABCpreview123', 'STORE_abcpreview123']) {
      expect(makeStore(readConfig({ CRM_PREVIEW_READ_WRITE_TOKEN: PREVIEW_TOKEN, CRM_PREVIEW_STORE_ID: id }))?.kind, id).toBe('vercel-blob');
    }
  });
  it('refuses something that is not a read-write token', () => {
    const cfg = readConfig({ CRM_PREVIEW_READ_WRITE_TOKEN: 'not-a-token', CRM_PREVIEW_STORE_ID: 'store_abc' });
    expect(makeStore(cfg)).toBeNull();
    expect(blobProblems(cfg)[0]).toMatch(/not a read-write token/);
  });
  it('needs the store id as well as the token', () => {
    const cfg = readConfig({ CRM_PREVIEW_READ_WRITE_TOKEN: PREVIEW_TOKEN });
    expect(makeStore(cfg)).toBeNull();
    expect(blobProblems(cfg)).toEqual(['CRM_PREVIEW_STORE_ID']);
  });
  it('a different prefix (for a later Production store) reads only its own variables, and must be a CRM_ name', () => {
    const env = { ...PREVIEW, CRM_PROD_READ_WRITE_TOKEN: PROD_TOKEN, CRM_PROD_STORE_ID: 'xyzPRODUCTION9' };
    expect(readConfig({ ...env, CRM_BLOB_VARIABLE_PREFIX: 'CRM_PROD' })).toMatchObject({ blobVarPrefix: 'CRM_PROD', blobToken: PROD_TOKEN });
    for (const bad of ['BLOB', 'blob', 'CRM_', 'CRM_preview', '', 'CRM-PREVIEW', 'BLOB_READ_WRITE_TOKEN']) {
      const cfg = readConfig({ ...env, ...PRODUCTION, CRM_BLOB_VARIABLE_PREFIX: bad });
      expect(cfg.blobVarPrefix).toBeNull();
      expect(makeStore(cfg), JSON.stringify(bad)).toBeNull();
      expect(blobProblems(cfg)).toEqual(['CRM_BLOB_VARIABLE_PREFIX (must look like CRM_PREVIEW)']);
    }
  });
  it('the directory store (local development) is chosen only when asked for explicitly', () => {
    expect(makeStore(readConfig({ CRM_STORE_DIR: '/tmp/x', ...PREVIEW }))?.kind).toBe('file');
    expect(makeStore(readConfig({ ...PREVIEW }))?.kind).toBe('vercel-blob');
  });
  it('server code never reads the project\'s BLOB_ variables', () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = [...walk(path.resolve(__dirname, '../server')), ...walk(path.resolve(__dirname, '../../api')), ...walk(path.resolve(__dirname, '../api'))];
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, f).not.toMatch(/\bBLOB_(READ_WRITE_TOKEN|STORE_ID)\b|VERCEL_OIDC_TOKEN|process\.env\.BLOB/);
    }
  });
});
