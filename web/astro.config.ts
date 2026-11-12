import node from '@astrojs/node';
import type { AstroIntegration } from 'astro';
import { defineConfig } from 'astro/config';
import { WEB_DOMAIN } from '../functions/lib/auth/constants.js';

// Server-rendered on a Node server (locally, or in Lambda behind API Gateway): the API key,
// client secret and tokens stay on the server, and the browser gets plain HTML (no client-side
// JavaScript framework).
export default defineConfig({
  // The public address: absolute URLs in share cards and canonical links use it.
  site: `https://${WEB_DOMAIN}`,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321, host: 'localhost' },
  // Local pages look exactly like the hosted site (screenshots, reviews).
  devToolbar: { enabled: false },
  security: {
    // On by default; stated because the POST forms rely on it: cross-site form posts are refused.
    checkOrigin: true,
    // Behind a proxy, trust the Host and X-Forwarded-Proto headers only for our own domain.
    // Without this Astro sees every request as http://localhost, so the origin check refuses
    // every form post and cookies lose `Secure` (docs/adr/0013-hosting-the-web-front-end.md).
    allowedDomains: [{ hostname: WEB_DOMAIN, protocol: 'https' }],
  },
  integrations: [bundleDependencies()],
});

/**
 * For `astro build` only: bundle every dependency into the server build, so it runs without
 * node_modules (in Lambda). Not in dev, where Vite's dev server can't run some CommonJS packages.
 */
function bundleDependencies(): AstroIntegration {
  return {
    name: 'bundle-dependencies',
    hooks: {
      'astro:config:setup': ({ command, updateConfig }) => {
        if (command === 'build') updateConfig({ vite: { ssr: { noExternal: true } } });
      },
    },
  };
}
