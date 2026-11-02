// Which Blob store a deployment uses and how it is named. The connected store (BLOB_STORE_ID) is reached with Vercel's OIDC token;
// the test store must never be used for the real dashboard; Preview and Production keep their data in separate folders.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blobProblems, makeStore, readConfig } from '../server/config.js';

const REAL = 'store_realStore123';
const TEST_STORE = 'store_testStore456';

describe('Blob store selection', () => {
  it('uses the connected store named by BLOB_STORE_ID and builds the private Blob store (no token variable needed)', () => {
    const cfg = readConfig({ BLOB_STORE_ID: REAL, BLOB_WEBHOOK_PUBLIC_KEY: 'unused' });
    expect(cfg.blobStoreId).toBe(REAL);
    expect(blobProblems(cfg)).toEqual([]);
    expect(makeStore(cfg)?.kind).toBe('vercel-blob');
  });
  it('is "not set up" without BLOB_STORE_ID, and never looks for a read-write token instead', () => {
    for (const env of [{}, { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x_y' }, { CRM_PREVIEW_READ_WRITE_TOKEN: 'vercel_blob_rw_x_y' }, { VERCEL_OIDC_TOKEN: 'oidc' }]) {
      const cfg = readConfig(env);
      expect(makeStore(cfg), JSON.stringify(Object.keys(env))).toBeNull();
      expect(blobProblems(cfg)).toEqual(['BLOB_STORE_ID (connect the Blob store to this project and environment)']);
      expect(JSON.stringify(cfg)).not.toMatch(/vercel_blob_rw|oidc/);
    }
  });
  it('refuses the test store, however it is written', () => {
    for (const blocked of [{ CRM_PREVIEW_STORE_ID: TEST_STORE }, { CRM_PREVIEW_STORE_ID: 'testStore456' }, { CRM_BLOCKED_BLOB_STORE_IDS: `other, ${TEST_STORE}` }, { CRM_BLOCKED_BLOB_STORE_IDS: 'TESTSTORE456' }]) {
      const cfg = readConfig({ BLOB_STORE_ID: TEST_STORE, ...blocked });
      expect(makeStore(cfg), JSON.stringify(blocked)).toBeNull();
      expect(blobProblems(cfg)).toEqual(['BLOB_STORE_ID is a store this deployment must not use (the test store)']);
    }
    // the real store is fine while the leftover test-store variables are still present
    expect(makeStore(readConfig({ BLOB_STORE_ID: REAL, CRM_PREVIEW_STORE_ID: TEST_STORE, CRM_PREVIEW_READ_WRITE_TOKEN: 'vercel_blob_rw_testStore456_s' }))?.kind).toBe('vercel-blob');
  });
  it('the directory store (local development) is chosen only when asked for explicitly', () => {
    expect(makeStore(readConfig({ CRM_STORE_DIR: '/tmp/x' }))?.kind).toBe('file');
    expect(makeStore(readConfig({ BLOB_STORE_ID: REAL }))?.kind).toBe('vercel-blob');
  });
});

describe('where the data lives inside the store', () => {
  it('Preview and Production use separate folders of the same store', () => {
    expect(readConfig({ BLOB_STORE_ID: REAL, VERCEL_ENV: 'production' }).prefix).toBe('crm-tracker/production');
    expect(readConfig({ BLOB_STORE_ID: REAL, VERCEL_ENV: 'preview' }).prefix).toBe('crm-tracker/preview');
    expect(readConfig({ BLOB_STORE_ID: REAL, VERCEL_ENV: 'development' }).prefix).toBe('crm-tracker/development');
  });
  it('outside Vercel, or with an odd VERCEL_ENV, the plain folder is used; an explicit CRM_BLOB_PREFIX wins', () => {
    expect(readConfig({}).prefix).toBe('crm-tracker');
    expect(readConfig({ VERCEL_ENV: '../etc' }).prefix).toBe('crm-tracker');
    expect(readConfig({ VERCEL_ENV: 'preview', CRM_BLOB_PREFIX: '/team-a/crm/' }).prefix).toBe('team-a/crm');
  });
});

describe('credentials never come from configuration', () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const code = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  it('server code reads no BLOB_READ_WRITE_TOKEN, no OIDC variable and no token variable of any kind', () => {
    const files = [...walk(path.resolve(__dirname, '../server')), ...walk(path.resolve(__dirname, '../../api')), ...walk(path.resolve(__dirname, '../api'))];
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) expect(code(f), f).not.toMatch(/BLOB_READ_WRITE_TOKEN|READ_WRITE_TOKEN|VERCEL_OIDC_TOKEN|process\.env\.BLOB_(?!STORE_ID)/);
  });
  it('the store never passes a read-write token to the SDK', () => {
    expect(code(path.resolve(__dirname, '../server/store-vercel.ts'))).not.toMatch(/\btoken\s*:/);
  });
});
