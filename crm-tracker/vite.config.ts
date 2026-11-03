import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

const src = (p: string) => path.resolve(__dirname, p);

// Three ways to run this config:
//   default            normal multi-file build for Netlify (ships with NO data)
//   --mode vercel      normal multi-file build WITH the sanitized embedded data as the fallback (published data wins when available)
//   --mode single      one self-contained HTML file with the generated data snapshot embedded
//   vitest             tests (no snapshot, normal worker)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const embed = single || mode === 'vercel';
  return {
    plugins: [
      react(),
      ...(single
        ? [
            viteSingleFile(),
            {
              // a file:// page cannot load /theme-init.js, and the CSP of the hosted builds forbids inline scripts: inline it only here
              name: 'inline-theme-init',
              transformIndexHtml: (html: string) => html.replace('<script src="/theme-init.js"></script>', `<script>${fs.readFileSync(src('public/theme-init.js'), 'utf8')}</script>`),
            },
          ]
        : []),
    ],
    resolve: {
      alias: [
        { find: /^@snapshot$/, replacement: src(embed ? 'src/generated/snapshot.data.ts' : 'src/generated/snapshot.empty.ts') },
        { find: /^@workerSpawn$/, replacement: src(single ? 'src/workers/spawn.single.ts' : 'src/workers/spawn.ts') },
        { find: /^@\//, replacement: src('src') + '/' },
      ],
    },
    // the inline worker of the single-file build is a classic (iife) script: it starts reliably from a blob, also for file:// pages
    worker: { format: single ? ('iife' as const) : ('es' as const) },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 6000,
      ...(single ? { outDir: 'dist-single' } : {}),
      rollupOptions: single
        ? {}
        : {
            output: {
              manualChunks: {
                react: ['react', 'react-dom', 'react-router-dom'],
                charts: ['recharts'],
              },
            },
          },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      testTimeout: 60000,
      hookTimeout: 60000,
    },
  };
});
