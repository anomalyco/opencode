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
RUN bun run build:veritly-hosted

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
