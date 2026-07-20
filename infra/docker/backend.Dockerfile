# 后端镜像（方案 §10.1）：api 与 worker 同一镜像、不同入口（app.main vs app.worker）。
# 用 uv 装依赖，psycopg2 需要编译期依赖。

FROM python:3.13-slim AS base
WORKDIR /app/backend

# psycopg2 编译依赖 + akshare 运行依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 依赖层（利用缓存）
COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev

# 应用代码
COPY backend/ ./

ENV PATH="/app/backend/.venv/bin:$PATH"
ENV PYTHONPATH=/app/backend

RUN chmod +x docker-entrypoint.sh

# 默认起 API；worker 和一次性 init-db 在 compose 里覆盖 command。
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
