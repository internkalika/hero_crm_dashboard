// The deployment is configured from the repository root (the existing Vercel project keeps its Root Directory), with
// thin api/ shims that re-export the handlers in crm-tracker/server. These tests keep the two in step.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as login from '../server/handlers/login.js';
import * as logout from '../server/handlers/logout.js';
import * as session from '../server/handlers/session.js';
import * as stage from '../server/handlers/stage.js';
import * as publish from '../server/handlers/publish.js';
import * as rollback from '../server/handlers/rollback.js';
import * as versions from '../server/handlers/versions.js';
import * as snapshot from '../server/handlers/snapshot.js';
import * as dataset from '../server/handlers/dataset.js';

const REPO = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');
const rootCfg = JSON.parse(read('vercel.json'));
const appCfg = JSON.parse(read('crm-tracker/vercel.json'));

/** route -> [handler module, the one method the shim must expose] */
const ENDPOINTS: Record<string, [Record<string, unknown>, 'GET' | 'POST', string]> = {
  '/api/snapshot': [snapshot, 'GET', 'snapshot'],
  '/api/dataset': [dataset, 'GET', 'dataset'],
  '/api/admin/session': [session, 'GET', 'session'],
  '/api/admin/versions': [versions, 'GET', 'versions'],
  '/api/admin/login': [login, 'POST', 'login'],
  '/api/admin/logout': [logout, 'POST', 'logout'],
  '/api/admin/stage': [stage, 'POST', 'stage'],
  '/api/admin/publish': [publish, 'POST', 'publish'],
  '/api/admin/rollback': [rollback, 'POST', 'rollback'],
};

const walk = (d: string): string[] => fs.readdirSync(path.join(REPO, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

describe('root api shims (the functions Vercel deploys)', () => {
  it('are exactly the nine endpoints, one file each', () => {
    expect(walk('api').sort()).toEqual(Object.keys(ENDPOINTS).map((r) => `${r.slice(1)}.ts`).sort());
  });
  for (const [route, [mod, method, handler]] of Object.entries(ENDPOINTS)) {
    it(`${route}: exposes only ${method}, from crm-tracker/server/handlers/${handler}`, () => {
      const src = read(`${route.slice(1)}.ts`);
      const m = /export \{ (\w+) \} from '([^']+)';/.exec(src);
      expect(m, 'a single re-export').not.toBeNull();
      expect(m![1]).toBe(method);
      const target = path.resolve(path.dirname(path.join(REPO, `${route.slice(1)}.ts`)), m![2].replace(/\.js$/, '.ts'));
      expect(target).toBe(path.join(REPO, `crm-tracker/server/handlers/${handler}.ts`));
      expect(fs.existsSync(target)).toBe(true);
      expect(typeof mod[method]).toBe('function');
      expect(src.match(/^export /gm)).toHaveLength(1); // nothing else is exposed as an endpoint
    });
  }
  it('every relative import ends in .js (Node ES modules, what Vercel runs)', () => {
    for (const f of walk('api')) for (const m of read(f).matchAll(/from '(\.[^']+)'/g)) expect(m[1]).toMatch(/\.js$/);
  });
  it('mirror the shims inside crm-tracker/api (used when the project root is crm-tracker)', () => {
    const app = fs.readdirSync(path.join(REPO, 'crm-tracker/api'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).sort();
    expect(app).toEqual(walk('api').map((f) => f.replace(/^api\//, '')).sort());
  });
});

describe('root vercel.json', () => {
  it('builds from the repository root, so the project keeps its Root Directory', () => {
    expect(rootCfg).toMatchObject({ framework: null, installCommand: 'cd crm-tracker && npm ci', buildCommand: 'cd crm-tracker && npm run build:vercel', outputDirectory: 'crm-tracker/dist' });
    expect(rootCfg.functions).toEqual({ 'api/**/*.ts': { maxDuration: 60 } });
  });
  it('the build script is the one the config calls, and it reads the root index.html', () => {
    const pkg = JSON.parse(read('crm-tracker/package.json'));
    expect(pkg.scripts['build:vercel']).toBe('npm run extract && tsc --noEmit && vite build --mode vercel');
    expect(pkg.scripts.extract).toBe('vite-node scripts/extract-from-deployed.ts');
    const extract = read('crm-tracker/scripts/extract-from-deployed.ts');
    expect(extract).toMatch(/new URL\('\.\.\/\.\.\/index\.html', import\.meta\.url\)/); // scripts/ -> crm-tracker/ -> repository root
    expect(fs.existsSync(path.join(REPO, 'index.html'))).toBe(true);
  });
  it('serves the single-page app for every route except /api and /assets', () => {
    const [{ source, destination }] = rootCfg.rewrites;
    expect(destination).toBe('/index.html');
    const re = new RegExp(`^${source}$`);
    for (const p of ['/', '/admin', '/import', '/overview', '/datasense/employees', '/compare/bizom-vs-sfa', '/dealer/orders', '/hero-smiles']) expect(re.test(p), p).toBe(true);
    for (const p of [...Object.keys(ENDPOINTS), '/api/anything', '/assets/index-abc.js']) expect(re.test(p), p).toBe(false);
  });
  it('has the same security headers as the app-level config', () => {
    expect(rootCfg.headers).toEqual(appCfg.headers);
    const csp = rootCfg.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value as string;
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/connect-src 'self'/); // the page only talks to its own /api
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).not.toMatch(/unsafe-eval|https?:\/\//);
  });
  it('root package.json marks the shims as ES modules and pins Node 22', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg).toMatchObject({ type: 'module', engines: { node: '22.x' }, private: true });
    expect(pkg.dependencies).toBeUndefined(); // nothing is installed at the root: the install command runs in crm-tracker
  });
});

describe('the Blob store is private', () => {
  it('no source file asks for public access', () => {
    for (const f of [...walk('crm-tracker/server'), ...walk('crm-tracker/src/lib/sync'), ...walk('crm-tracker/src/lib/publish')]) {
      expect(read(f), f).not.toMatch(/access:\s*['"]public['"]/);
    }
    expect(read('crm-tracker/server/store-vercel.ts')).toMatch(/access: 'private'/g);
  });
});
