// ABOUTME: Astro configuration with React integration for interactive islands.
// ABOUTME: Outputs static HTML for Cloudflare Pages deployment.
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  output: 'static',
});
