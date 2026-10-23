// Vite builds the React assets and Worker entry together; no Flue build plugin participates.
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: { target: "es2022" },
});
