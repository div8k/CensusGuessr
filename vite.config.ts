import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Adds a Content-Security-Policy to the production page. The game is fully
 * static, so the only thing allowed off-origin is map tile images.
 * (Not applied to the dev server, whose hot-reload client needs inline scripts.
 * `frame-ancestors` cannot be set from a meta tag; GitHub Pages sets no headers.)
 */
function contentSecurityPolicy(tileUrl: string): Plugin {
  const tileOrigin = new URL(tileUrl.replace('{s}.', 'SUB.')).origin.replace('SUB.', '*.');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Leaflet positions the map with inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${tileOrigin}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'censusguessr-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// Relative base so the build works at any GitHub Pages path
// (https://user.github.io/repo/) without configuration.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    base: './',
    plugins: [react(), contentSecurityPolicy(env.VITE_TILE_URL || DEFAULT_TILE_URL)],
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
