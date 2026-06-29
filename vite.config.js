import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4173",
      "/reports": "http://127.0.0.1:4173"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
