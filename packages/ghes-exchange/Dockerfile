FROM oven/bun:1.3 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY patches patches
COPY packages packages
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @opencode-ai/ghes-exchange

FROM base AS release
WORKDIR /app/packages/ghes-exchange
COPY --from=install /app/node_modules /app/node_modules
COPY packages/ghes-exchange/src src
COPY packages/ghes-exchange/package.json .

ENV PORT=3000
EXPOSE 3000

USER bun
ENTRYPOINT ["bun", "run", "src/index.ts"]
