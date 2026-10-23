// Run durable-state tests in workerd with real SQLite, but no remote inference bindings.
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/worker/**/*.test.ts"], fsModuleCache: false },
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { DEV_AUTH: "local" },
        ai: { binding: "AI", remoteProxyConnectionString: undefined },
      },
    }),
  ],
});
