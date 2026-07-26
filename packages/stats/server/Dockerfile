FROM oven/bun:1.3.14-alpine AS base

WORKDIR /app

ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

FROM base AS pruner

COPY . .

RUN bunx turbo@2.8.13 prune @opencode-ai/stats-server --docker --no-update-notifier --no-color

FROM base AS installer

COPY --from=pruner /app/out/json/ ./

# Bun 1.3.x needs the pruned workspace globs and lockfile metadata refreshed before the frozen production install.
RUN bun -e 'const packageJson = await Bun.file("package.json").json(); packageJson.workspaces.packages = Array.from(new Bun.Glob("packages/**/package.json").scanSync(".")).map((file) => file.slice(0, -"/package.json".length)).sort(); await Bun.write("package.json", JSON.stringify(packageJson, null, 2) + "\n")'
RUN rm -f bun.lock && bun install --filter @opencode-ai/stats-server --lockfile-only --ignore-scripts
RUN bun install --filter @opencode-ai/stats-server --frozen-lockfile --production --ignore-scripts

FROM base AS runner

COPY --from=installer /app ./
COPY --from=pruner /app/out/full/ ./

WORKDIR /app/packages/stats/server

EXPOSE 3000

CMD ["bun", "src/server.ts"]
