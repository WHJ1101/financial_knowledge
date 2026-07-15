import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 开发期 Vite 代理 /api → FastAPI（生产由 Caddy 反代，方案 §10）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
