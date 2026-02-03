// ABOUTME: Astro configuration with React integration and Cloudflare SSR adapter.
// ABOUTME: Server-rendered so dynamic city/mayor pages are always up to date.
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: cloudflare(),
});
