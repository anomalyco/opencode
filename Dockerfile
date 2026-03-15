FROM oven/bun:1.3.10

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
    openssh-client \
    python3 \
    python3-venv \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN bun install

COPY railway/start-opencode-web.sh /usr/local/bin/start-opencode-web
RUN chmod +x /usr/local/bin/start-opencode-web

ENV XDG_DATA_HOME=/data/.local/share
ENV XDG_CONFIG_HOME=/data/.config
ENV XDG_CACHE_HOME=/data/.cache
ENV XDG_STATE_HOME=/data/.local/state
ENV HOME=/data
ENV OPENCODE_TEST_HOME=/data
ENV PORT=3000

EXPOSE 3000

CMD ["start-opencode-web"]
