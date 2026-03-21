FROM oven/bun:1.3.8

WORKDIR /app

ARG VITE_OPENCODE_LICENSE_URL
ENV VITE_OPENCODE_LICENSE_URL=${VITE_OPENCODE_LICENSE_URL}

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY . .

RUN bun install --frozen-lockfile
RUN bun --cwd packages/app build

EXPOSE 4096
