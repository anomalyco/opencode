FROM oven/bun:1.3.14-alpine AS base

WORKDIR /app

ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

FROM base AS pruner

COPY . .

RUN bunx turbo@2.8.13 prune @opencode-ai/app --docker --no-update-notifier --no-color

FROM base AS installer

COPY --from=pruner /app/out/json/ ./

RUN bun -e 'const packageJson = await Bun.file("package.json").json(); packageJson.workspaces.packages = Array.from(new Bun.Glob("packages/**/package.json").scanSync(".")).map((file) => file.slice(0, -"/package.json".length)).sort(); await Bun.write("package.json", JSON.stringify(packageJson, null, 2) + "\n")'
RUN rm -f bun.lock && bun install --filter @opencode-ai/app --lockfile-only --ignore-scripts
RUN bun install --filter @opencode-ai/app --frozen-lockfile --ignore-scripts

FROM base AS build

ARG VITE_OPENCODE_SERVER_URL=https://opencode-voice-server.fly.dev
ARG VITE_VOICE_SIDECAR_URL=https://opencode-voice-sidecar.fly.dev
ARG OPENCODE_CHANNEL=beta

ENV VITE_OPENCODE_SERVER_URL=$VITE_OPENCODE_SERVER_URL
ENV VITE_VOICE_SIDECAR_URL=$VITE_VOICE_SIDECAR_URL
ENV OPENCODE_CHANNEL=$OPENCODE_CHANNEL

COPY --from=installer /app ./
COPY --from=pruner /app/out/full/ ./

RUN bun run --cwd packages/app build

FROM nginx:1.27-alpine AS runner

COPY packages/app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
