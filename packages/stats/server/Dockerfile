FROM oven/bun:1.3.14-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY package.json bun.lock ./
COPY patches ./patches
COPY packages ./packages

RUN bun install --frozen-lockfile --production --ignore-scripts

WORKDIR /app/packages/stats/server

EXPOSE 3000

CMD ["bun", "src/server.ts"]
