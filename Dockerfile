FROM oven/bun:1.3.11 AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lockb bunfig.toml ./
COPY packages/opencode/package.json packages/opencode/
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
ENV OPENCODE_CHANNEL=latest OPENCODE_VERSION=0.0.0-enk
RUN cd packages/opencode && bun run build --single

FROM node:22-slim AS dev

ARG PYTHON_VERSION=3.11.2-1+b1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3=${PYTHON_VERSION} \
    curl wget procps jq make zip unzip less \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system core.excludesFile /etc/opencode/.gitignore

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

RUN adduser -D -u 1000 -h /home/jovyan jovyan
ENV OPENCODE_CONFIG_DIR=/etc/opencode HOME=/home/jovyan
WORKDIR /home/jovyan

COPY --from=build /app/packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode
COPY docker/AGENTS.md /etc/opencode/AGENTS.md
COPY docker/.gitignore /etc/opencode/.gitignore

EXPOSE 8888

CMD ["opencode", "web", "--port", "8888", "--hostname", "0.0.0.0"]
