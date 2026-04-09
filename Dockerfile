FROM oven/bun:1.3.10

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssh-client \
    python3 \
    python3-venv \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN bun install

# Browser-facing Univer + SDK relay (Vite inlines `import.meta.env.VITE_*` at build time).
# Pass as Docker build-args (e.g. Railway "Build" variables) for production images.
# If a variable is omitted, it is not exported so `packages/app/.env` can still supply it when present in the build context.
ARG VITE_UNIVER_BACKEND_URL
ARG VITE_UNIVER_SDK_WS
ARG VITE_UNIVER_LICENSE
RUN set -e; \
  if [ -n "${VITE_UNIVER_BACKEND_URL}" ]; then export VITE_UNIVER_BACKEND_URL="${VITE_UNIVER_BACKEND_URL}"; fi; \
  if [ -n "${VITE_UNIVER_SDK_WS}" ]; then export VITE_UNIVER_SDK_WS="${VITE_UNIVER_SDK_WS}"; fi; \
  if [ -n "${VITE_UNIVER_LICENSE}" ]; then export VITE_UNIVER_LICENSE="${VITE_UNIVER_LICENSE}"; fi; \
  bun run build:veritly-hosted

RUN python3 -m venv /opt/veritly-univer-sdk \
  && /opt/veritly-univer-sdk/bin/pip install --no-cache-dir /app/packages/univer-sdk/python
ENV PATH="/opt/veritly-univer-sdk/bin:$PATH"

COPY railway/start-opencode-serve.sh /usr/local/bin/start-opencode-serve
COPY railway/serve-custom-app.mjs /usr/local/bin/serve-custom-app.mjs
COPY railway/start-hosted-opencode.sh /usr/local/bin/start-hosted-opencode
RUN chmod +x /usr/local/bin/start-opencode-serve /usr/local/bin/start-hosted-opencode

ENV XDG_DATA_HOME=/data/.local/share
ENV XDG_CONFIG_HOME=/data/.config
ENV XDG_CACHE_HOME=/data/.cache
ENV XDG_STATE_HOME=/data/.local/state
ENV HOME=/data
ENV OPENCODE_TEST_HOME=/data
ENV OPENCODE_APP_DIST_DIR=/app/packages/app/dist
ENV PORT=3000

EXPOSE 3000

CMD ["start-hosted-opencode"]
