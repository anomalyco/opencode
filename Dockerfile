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
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode
COPY docker/AGENTS.md /etc/opencode/AGENTS.md
ENV OPENCODE_CONFIG_DIR=/etc/opencode

RUN adduser -D -u 1000 -h /home/jovyan jovyan
ENV HOME=/home/jovyan
WORKDIR /home/jovyan

EXPOSE 8888

CMD ["opencode", "web", "--port", "8888", "--hostname", "0.0.0.0"]
