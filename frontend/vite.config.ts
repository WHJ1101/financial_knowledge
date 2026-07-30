import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";

// 开发期 Vite 代理 /api → FastAPI（生产由 Caddy 反代，方案 §10）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    // 使用 IPv6 wildcard；Node 默认 ipv6Only=false，可同时接受 IPv6/IPv4 请求。
    // 仅用于本地开发；如需避免监听局域网，请改回 "localhost"。
    host: "::",
    port: 5173,
    proxy: {
      "/api": { target: apiProxyTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
