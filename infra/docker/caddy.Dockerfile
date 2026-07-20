# 前端构建 → Caddy 运行镜像（方案 §10.1）
# Caddy 独占前端静态资源；不含后端代码。

# --- 阶段 1：Vite 构建前端 ---
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- 阶段 2：Caddy 运行时 ---
FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /app/frontend/dist /srv/dist
EXPOSE 80 443
