// Flue's config helper validates this small target-specific build definition.
import { defineConfig } from '@flue/runtime/config';

// Cloudflare mode generates the Worker and Durable Object integration used at deploy time.
export default defineConfig({
  target: 'cloudflare',
});
