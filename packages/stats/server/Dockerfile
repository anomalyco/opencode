FROM oven/bun:1.3.14-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

COPY package.json bun.lock ./
COPY patches ./patches
COPY packages/app/package.json ./packages/app/package.json
COPY packages/console/app/package.json ./packages/console/app/package.json
COPY packages/console/core/package.json ./packages/console/core/package.json
COPY packages/console/function/package.json ./packages/console/function/package.json
COPY packages/console/mail/package.json ./packages/console/mail/package.json
COPY packages/console/resource/package.json ./packages/console/resource/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/desktop/package.json ./packages/desktop/package.json
COPY packages/effect-drizzle-sqlite/package.json ./packages/effect-drizzle-sqlite/package.json
COPY packages/enterprise/package.json ./packages/enterprise/package.json
COPY packages/function/package.json ./packages/function/package.json
COPY packages/http-recorder/package.json ./packages/http-recorder/package.json
COPY packages/llm/package.json ./packages/llm/package.json
COPY packages/opencode/package.json ./packages/opencode/package.json
COPY packages/plugin/package.json ./packages/plugin/package.json
COPY packages/script/package.json ./packages/script/package.json
COPY packages/sdk/js/package.json ./packages/sdk/js/package.json
COPY packages/slack/package.json ./packages/slack/package.json
COPY packages/stats/app/package.json ./packages/stats/app/package.json
COPY packages/stats/core/package.json ./packages/stats/core/package.json
COPY packages/stats/server/package.json ./packages/stats/server/package.json
COPY packages/storybook/package.json ./packages/storybook/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/web/package.json ./packages/web/package.json

RUN bun install --frozen-lockfile --production --ignore-scripts

COPY packages ./packages

WORKDIR /app/packages/stats/server

EXPOSE 3000

CMD ["bun", "src/server.ts"]
