FROM oven/bun:1.3 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=install /app/node_modules node_modules
COPY src src
COPY package.json .

ENV PORT=3000
EXPOSE 3000

USER bun
ENTRYPOINT ["bun", "run", "src/index.ts"]
