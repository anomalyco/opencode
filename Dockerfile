FROM oven/bun:1.3.11-alpine AS build

RUN apk add --no-cache nodejs-current build-base python3

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ENV OPENCODE_CHANNEL=latest OPENCODE_VERSION=0.0.0-enk
RUN cd packages/opencode && bun run build --single

FROM alpine:3.21 AS dev

ARG PYTHON_VERSION=3.12.12-r0
ARG NODE_VERSION=22.15.1-r0
ARG NPM_VERSION=10.9.1-r0

RUN apk add --no-cache git ca-certificates libstdc++ libgcc gcompat \
    python3=${PYTHON_VERSION} nodejs=${NODE_VERSION} npm=${NPM_VERSION}

COPY --from=build /app/packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode

RUN adduser -D -u 1000 -h /home/jovyan jovyan
ENV HOME=/home/jovyan
WORKDIR /home/jovyan

EXPOSE 8888

CMD ["opencode", "web", "--port", "8888", "--hostname", "0.0.0.0"]
