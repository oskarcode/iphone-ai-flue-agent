// Vite combines Flue's agent transform with Cloudflare's Worker build and local development runtime.
import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

// flueWorkerConfig passes Flue's generated Worker configuration into the Cloudflare plugin.
export default defineConfig({
  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
});
