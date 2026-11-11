import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

// Server-rendered on a local Node server: the API key, client secret and tokens stay on the
// server, and the browser gets plain HTML (no client-side JavaScript framework).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321, host: 'localhost' },
  // On by default; stated because the POST forms rely on it: cross-site form posts are refused.
  security: { checkOrigin: true },
});
