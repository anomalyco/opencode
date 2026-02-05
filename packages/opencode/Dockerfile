FROM alpine:3.20 AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ ripgrep

# Create non-root user for security
RUN addgroup -S opencode && adduser -S opencode -G opencode

FROM base AS build-amd64
COPY dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}

# Verify the binary works
RUN opencode --version

# Set ownership of app-relevant directories to non-root user
RUN mkdir -p /home/opencode && chown -R opencode:opencode /home/opencode

# Health check (validates the binary is still functional)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD opencode --version || exit 1

# Switch to non-root user
USER opencode

ENTRYPOINT ["opencode"]
