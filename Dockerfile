FROM oven/bun:1.3.11 AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts

ENV OPENCODE_CHANNEL=latest OPENCODE_VERSION=0.0.0-enk
RUN cd packages/opencode && bun run build --single

FROM node:22-slim AS dev

ARG PYTHON_VERSION=3.11.2-1+b1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3=${PYTHON_VERSION} \
    curl wget procps jq make zip unzip less \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system core.excludesFile /etc/opencode/.gitignore

ARG PLAYWRIGHT_MCP_VERSION=0.0.70
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npm install -g @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
    && npx playwright install --with-deps chromium \
    && rm -rf /tmp/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ARG NB_USER="jovyan"
RUN userdel -r node && useradd -l -m -s /bin/bash -N -u 1000 "${NB_USER}"

ENV OPENCODE_CONFIG_DIR=/etc/opencode HOME="/home/${NB_USER}"
WORKDIR /home/${NB_USER}/project

# 런타임 UID가 빌드 시와 다를 수 있으므로 모두에게 권한을 부여한다.
RUN chmod -R 777 ${HOME} \
    && chmod -R 777 ${PLAYWRIGHT_BROWSERS_PATH}

COPY --from=build /app/packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode
COPY docker/AGENTS.md /etc/opencode/AGENTS.md
COPY docker/.gitignore /etc/opencode/.gitignore
COPY docker/opencode.jsonc /etc/opencode/opencode.jsonc
COPY docker/preview-bridge-plugin.js /etc/opencode/preview-bridge-plugin.js
COPY docker/preview-bridge.js /etc/opencode/preview-bridge.js

EXPOSE 8888

CMD ["opencode", "web", "--port", "8888", "--hostname", "0.0.0.0"]
