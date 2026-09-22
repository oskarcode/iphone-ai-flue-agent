// Vitest provides a fast Node environment for pure parsers, validators, and generated-page checks.
import { defineConfig } from 'vitest/config';

// Tests intentionally avoid a browser emulator; chat-page.test.ts syntax-checks the embedded script.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
