# ========================================
# Base images for musl vs glibc
# ========================================

# Alpine base for musl
FROM alpine AS base-musl
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ ripgrep ca-certificates

# Debian base for glibc / baseline
FROM debian:13-slim AS base-glibc
RUN apt-get update && apt-get install -y \
        ca-certificates libgcc1 libstdc++6 ripgrep \
    && rm -rf /var/lib/apt/lists/*

# ========================================
# Build stages for Linux binaries
# ========================================

# x64 musl
FROM base-musl AS build-x64-musl
COPY dist/opencode-linux-x64-musl/bin/opencode /usr/local/bin/opencode

# arm64 musl
FROM base-musl AS build-arm64-musl
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

# x64 glibc
FROM base-glibc AS build-x64-glibc
COPY dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode

# x64 baseline
FROM base-glibc AS build-x64-baseline
COPY dist/opencode-linux-x64-baseline/bin/opencode /usr/local/bin/opencode

# arm64 glibc
FROM base-glibc AS build-arm64-glibc
COPY dist/opencode-linux-arm64/bin/opencode /usr/local/bin/opencode

# ========================================
# Final stage selection
# ========================================

ARG TARGETARCH=amd64
ARG LIBC=musl  # musl, glibc, baseline
FROM build-${TARGETARCH}-${LIBC} AS final

# Optional: verify binary
RUN opencode --version

ENTRYPOINT ["opencode"]
