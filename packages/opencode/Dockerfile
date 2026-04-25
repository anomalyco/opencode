ARG BASE_IMAGE=alpine:3.21
FROM ${BASE_IMAGE} AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
ARG TARGETARCH
ARG DIST_SUFFIX=-musl
COPY dist /tmp/dist
RUN if [ -f /etc/alpine-release ]; then \
      apk add --no-cache libgcc libstdc++ ripgrep; \
    else \
      apt-get update; \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libgcc-s1 libstdc++6 ripgrep; \
      rm -rf /var/lib/apt/lists/*; \
    fi && \
    arch="$TARGETARCH" && \
    case "$arch" in \
      amd64) arch=x64 ;; \
      arm64) arch=arm64 ;; \
      *) exit 1 ;; \
    esac && \
    cp "/tmp/dist/opencode-linux-${arch}${DIST_SUFFIX}/bin/opencode" /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

RUN opencode --version
ENTRYPOINT ["opencode"]
