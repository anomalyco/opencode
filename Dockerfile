FROM oven/bun:1.3.11-alpine AS build

RUN apk add --no-cache git nodejs

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/opencode/package.json packages/opencode/
COPY packages/app/package.json packages/app/
COPY packages/sdk packages/sdk
COPY packages/ui packages/ui
COPY packages/tui packages/tui
RUN bun install --frozen-lockfile

COPY packages/opencode packages/opencode
COPY packages/app packages/app
RUN cd packages/opencode && bun run build --single --skip-embed-web-ui

FROM alpine:3.21 AS dev

RUN apk add --no-cache git ca-certificates libstdc++ libgcc

COPY --from=build /app/packages/opencode/dist/opencode-linux-x64-baseline /usr/local/bin/opencode

RUN adduser -D -u 1000 -h /home/jovyan jovyan
ENV HOME=/home/jovyan
WORKDIR /home/jovyan

EXPOSE 8888

CMD ["opencode", "web", "--port", "8888", "--hostname", "0.0.0.0"]
