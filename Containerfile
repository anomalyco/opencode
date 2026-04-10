# syntax=docker/dockerfile:1.7
#
# opencode — UBI 9 multi-stage build
#
# Build examples:
#   podman build -t opencode:latest -f Containerfile .
#   podman build --build-arg BUN_VERSION=1.3.11 -f Containerfile .

ARG UBI_IMAGE="registry.access.redhat.com/ubi9/ubi"
ARG UBI_MINIMAL_IMAGE="registry.access.redhat.com/ubi9/ubi-minimal"

# ── Stage 1: Build ────────────────────────────────────────────
FROM ${UBI_IMAGE} AS builder

ARG BUN_VERSION=1.3.11
ARG NODE_VERSION=22.16.0

USER 0

ENV BUN_INSTALL=/opt/app-root/.bun
ENV PATH=/opt/app-root/.bun/bin:${PATH}

RUN dnf install -y --nodocs --disablerepo='*' --enablerepo='ubi-*' \
      gcc g++ git make pkg-config python3 unzip xz && \
    dnf clean all

RUN set -eux; \
    arch=$(uname -m); \
    case "$arch" in \
      x86_64)  node_arch=x64 ;; \
      aarch64) node_arch=arm64 ;; \
      *) echo "unsupported arch: $arch" && exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
      | tar -xJf - -C /usr/local --strip-components=1; \
    npm install -g node-gyp

RUN set -eux; \
    arch=$(uname -m); \
    case "$arch" in \
      x86_64)  bun_arch=x64 ;; \
      aarch64) bun_arch=aarch64 ;; \
      *) echo "unsupported arch: $arch" && exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/bun.zip \
      "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip"; \
    unzip -qo /tmp/bun.zip -d /tmp; \
    mkdir -p /opt/app-root/.bun/bin; \
    mv "/tmp/bun-linux-${bun_arch}/bun" /opt/app-root/.bun/bin/bun; \
    chmod +x /opt/app-root/.bun/bin/bun; \
    rm -rf /tmp/bun*

ARG RIPGREP_VERSION=14.1.1
RUN set -eux; \
    arch=$(uname -m); \
    case "$arch" in \
      x86_64)  rg_arch=x86_64-unknown-linux-musl ;; \
      aarch64) rg_arch=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported arch: $arch" && exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/rg.tar.gz \
      "https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-${rg_arch}.tar.gz"; \
    tar -xzf /tmp/rg.tar.gz -C /tmp; \
    mv "/tmp/ripgrep-${RIPGREP_VERSION}-${rg_arch}/rg" /usr/local/bin/rg; \
    chmod +x /usr/local/bin/rg; \
    rm -rf /tmp/rg.tar.gz /tmp/ripgrep-*

WORKDIR /build

COPY bun.lock bunfig.toml package.json turbo.json ./
COPY patches/ patches/
COPY packages/ packages/

RUN --mount=type=cache,id=opencode-bun-cache,target=/opt/app-root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile

COPY . .

ARG OPENCODE_CHANNEL=latest
ENV OPENCODE_CHANNEL=${OPENCODE_CHANNEL}

RUN cd packages/opencode && bun run script/build.ts --single

# ── Stage 2: Runtime (UBI 9 minimal) ─────────────────────────
FROM ${UBI_MINIMAL_IMAGE}

LABEL org.opencontainers.image.source="https://github.com/anomalyco/opencode" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="OpenCode (UBI 9)" \
      org.opencontainers.image.description="AI-powered development tool"

USER 0

RUN microdnf update -y && \
    microdnf install -y --nodocs \
      ca-certificates \
      diffutils \
      findutils \
      git \
      gzip \
      jq \
      make \
      openssh-clients \
      patch \
      procps-ng \
      python3 \
      python3-pip \
      shadow-utils \
      tar \
      vim-minimal \
      which && \
    microdnf clean all

RUN useradd -u 1001 -g 0 -d /home/opencode -m opencode && \
    mkdir -p /opt/app-root/bin /opt/app-root/venv \
             /home/opencode/.opencode \
             /home/opencode/.cache/opencode/bin \
             /home/opencode/.config/opencode \
             /home/opencode/.local/share/opencode/log && \
    chown -R 1001:0 /home/opencode /opt/app-root && \
    chmod -R g=u /home/opencode /opt/app-root

RUN python3 -m venv /opt/app-root/venv && \
    /opt/app-root/venv/bin/pip install --no-cache-dir uv && \
    chown -R 1001:0 /opt/app-root/venv

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
ENV HOME=/home/opencode
ENV PATH="/opt/app-root/venv/bin:/opt/app-root/bin:${PATH}"

COPY --from=builder /usr/local/bin/rg /opt/app-root/bin/rg
COPY --from=builder --chown=1001:0 \
     /build/packages/opencode/dist/opencode-linux-*/bin/opencode \
     /opt/app-root/bin/opencode

RUN opencode --version

USER 1001

ENTRYPOINT ["opencode"]
