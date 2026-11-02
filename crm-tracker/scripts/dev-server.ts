// Local stand-in for the Vercel deployment: serves dist/ (single-page app) and the /api functions from server/.
//   npm run build:vercel            (or vite build --mode vercel)
//   CRM_STORE_DIR=.local-store CRM_ADMIN_SECRET=... CRM_SESSION_SECRET=... CRM_PUBLISH_PEPPER=... npm run dev:server
// The store is a directory instead of a private Blob store; everything else is the code that runs on Vercel.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as login from '../server/handlers/login';
import * as logout from '../server/handlers/logout';
import * as session from '../server/handlers/session';
import * as stage from '../server/handlers/stage';
import * as publish from '../server/handlers/publish';
import * as rollback from '../server/handlers/rollback';
import * as versions from '../server/handlers/versions';
import * as snapshot from '../server/handlers/snapshot';
import * as dataset from '../server/handlers/dataset';
import * as health from '../server/handlers/health';

type H = Partial<Record<string, (r: Request) => Promise<Response>>>;
const routes: Record<string, H> = {
  '/api/snapshot': snapshot, '/api/dataset': dataset, '/api/health': health,
  '/api/admin/login': login, '/api/admin/logout': logout, '/api/admin/session': session, '/api/admin/stage': stage,
  '/api/admin/publish': publish, '/api/admin/rollback': rollback, '/api/admin/versions': versions,
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.env.DIST_DIR ?? 'dist');
const port = Number(process.env.PORT ?? 4175);
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const route = routes[url.pathname];
  if (url.pathname.startsWith('/api/')) {
    const fn = route?.[req.method ?? ''];
    if (!fn) {
      res.writeHead(route ? 405 : 404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await fn(new Request(url, { method: req.method, headers, body: req.method === 'GET' ? undefined : body }));
    const out: Record<string, string | string[]> = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = r.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(r.status, out);
    res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
    return;
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // single-page app
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`CRM Tracker dev server on http://localhost:${port}  (store: ${process.env.CRM_STORE_DIR ?? 'none'})`));
