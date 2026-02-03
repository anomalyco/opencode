FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
COPY dist/lotioncode-linux-x64-baseline-musl/bin/lotioncode /usr/local/bin/lotioncode

FROM base AS build-arm64
COPY dist/lotioncode-linux-arm64-musl/bin/lotioncode /usr/local/bin/lotioncode

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN lotioncode --version
ENTRYPOINT ["lotioncode"]
