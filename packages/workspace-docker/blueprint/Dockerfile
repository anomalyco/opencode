FROM debian:trixie-slim

ARG DEBIAN_FRONTEND=noninteractive
ARG BUN_VERSION=1.3.14
ARG TARGETARCH
ARG REPOSITORY
ARG REF=v2
ARG WORKSPACE_DIR=/workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    fd-find \
    git \
    jq \
    node-gyp \
    nodejs \
    openssh-client \
    python3 \
    ripgrep \
    unzip \
    xz-utils \
    zip \
  && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in amd64) bun_arch=x64 ;; arm64) bun_arch=aarch64 ;; *) exit 1 ;; esac \
  && curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip" -o /tmp/bun.zip \
  && mkdir -p /opt/bun \
  && unzip -q /tmp/bun.zip -d /opt/bun \
  && ln -s "/opt/bun/bun-linux-${bun_arch}/bun" /usr/local/bin/bun \
  && rm /tmp/bun.zip

RUN useradd --create-home --uid 1000 --shell /bin/bash opencode \
  && test -n "$REPOSITORY" \
  && git clone --branch "$REF" --single-branch "$REPOSITORY" "$WORKSPACE_DIR" \
  && chown -R opencode:opencode "$WORKSPACE_DIR"

USER opencode
WORKDIR ${WORKSPACE_DIR}
RUN bun install --frozen-lockfile
