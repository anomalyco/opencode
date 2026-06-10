FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep tini

FROM base AS build-amd64
COPY dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN opencode --version
# Run under tini as PID 1 so SIGINT/SIGTERM are forwarded to opencode and
# zombies are reaped. Without an init, PID 1 ignores signals that have no
# explicit handler (e.g. `serve`), so `^C` / `docker stop` would hang.
ENTRYPOINT ["tini", "--", "opencode"]
