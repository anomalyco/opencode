# Installing OpenCode Fork from Source in Docker

This guide explains how to install the [pRizz/opencode fork](https://github.com/pRizz/opencode) (which includes authentication features) in a Dockerfile instead of using the official opencode installer.

## Overview

The official opencode installer downloads pre-built binaries from `anomalyco/opencode` releases. Since the fork may not have releases or you want to build from source, we'll clone the repository and build it directly.

## Prerequisites

- Bun 1.3+ (already installed in the opencode-cloud Dockerfile)
- Git (already installed)
- Build tools (already installed)

## Installation Methods

### Method 1: Build from Source (Recommended)

This method clones the repository and builds opencode from source. It's the most reliable approach for forks.

```dockerfile
# -----------------------------------------------------------------------------
# opencode Installation (Fork from pRizz/opencode)
# -----------------------------------------------------------------------------
# Clone the fork and build from source
RUN git clone --depth 1 --branch dev https://github.com/pRizz/opencode.git /tmp/opencode \
    && cd /tmp/opencode \
    && bun install --frozen-lockfile \
    && bun run packages/opencode/script/build.ts --single \
    && mkdir -p /home/opencode/.opencode/bin \
    && cp /tmp/opencode/packages/opencode/dist/opencode-*/bin/opencode /home/opencode/.opencode/bin/opencode \
    && chmod +x /home/opencode/.opencode/bin/opencode \
    && rm -rf /tmp/opencode

# Add opencode to PATH
ENV PATH="/home/opencode/.opencode/bin:${PATH}"

# Verify installation
RUN /home/opencode/.opencode/bin/opencode --version
```

**Advantages:**
- Works with any fork or branch
- Always gets the latest code from the specified branch
- No dependency on GitHub releases
- Can pin to specific commit if needed

**Disadvantages:**
- Slower build time (clones repo, installs deps, builds)
- Requires build tools and dependencies

### Method 2: Install from Specific Commit

If you want to pin to a specific commit for reproducibility:

```dockerfile
# -----------------------------------------------------------------------------
# opencode Installation (Fork from pRizz/opencode - Pinned Commit)
# -----------------------------------------------------------------------------
ARG OPENCODE_COMMIT=dev  # or specific commit hash like "abc123def456"
RUN git clone --depth 1 --branch dev https://github.com/pRizz/opencode.git /tmp/opencode \
    && cd /tmp/opencode \
    && if [ "$OPENCODE_COMMIT" != "dev" ]; then git checkout "$OPENCODE_COMMIT"; fi \
    && bun install --frozen-lockfile \
    && bun run packages/opencode/script/build.ts --single \
    && mkdir -p /home/opencode/.opencode/bin \
    && cp /tmp/opencode/packages/opencode/dist/opencode-*/bin/opencode /home/opencode/.opencode/bin/opencode \
    && chmod +x /home/opencode/.opencode/bin/opencode \
    && rm -rf /tmp/opencode

ENV PATH="/home/opencode/.opencode/bin:${PATH}"
RUN /home/opencode/.opencode/bin/opencode --version
```

### Method 3: Use Install Script with Modified URL (If Fork Has Releases)

If the fork publishes releases, you can modify the install script to point to the fork:

```dockerfile
# -----------------------------------------------------------------------------
# opencode Installation (Fork from pRizz/opencode - Using Releases)
# -----------------------------------------------------------------------------
# Download and modify install script to use fork releases
RUN curl -fsSL https://raw.githubusercontent.com/pRizz/opencode/dev/install > /tmp/install.sh \
    && sed -i 's|anomalyco/opencode|pRizz/opencode|g' /tmp/install.sh \
    && bash /tmp/install.sh --no-modify-path \
    && rm /tmp/install.sh

ENV PATH="/home/opencode/.opencode/bin:${PATH}"
RUN /home/opencode/.opencode/bin/opencode --version
```

**Note:** This only works if `pRizz/opencode` publishes GitHub releases with the same naming convention.

## Integration into opencode-cloud Dockerfile

Here's how to replace the existing opencode installation section in the [opencode-cloud Dockerfile](https://github.com/pRizz/opencode-cloud/blob/90b3d308e8441f43a033df13939ad2451f4098cb/packages/core/src/docker/Dockerfile):

**Replace this section:**
```dockerfile
# -----------------------------------------------------------------------------
# opencode Installation
# -----------------------------------------------------------------------------
# opencode - self-managing installer, trusted to handle versions
# The script installs to ~/.opencode/bin/
# Retry logic added because opencode.ai API can be flaky during parallel builds
RUN for i in 1 2 3 4 5; do \
        curl -fsSL https://opencode.ai/install | bash && break || \
        echo "Attempt $i failed, retrying in 10s..." && sleep 10; \
    done \
    && ls -la /home/opencode/.opencode/bin/opencode \
    && /home/opencode/.opencode/bin/opencode --version

# Add opencode to PATH
ENV PATH="/home/opencode/.opencode/bin:${PATH}"
```

**With this:**
```dockerfile
# -----------------------------------------------------------------------------
# opencode Installation (Fork from pRizz/opencode)
# -----------------------------------------------------------------------------
# Clone the fork and build from source
# Using --depth 1 to minimize clone size and --branch dev for the dev branch
RUN git clone --depth 1 --branch dev https://github.com/pRizz/opencode.git /tmp/opencode \
    && cd /tmp/opencode \
    && bun install --frozen-lockfile \
    && bun run packages/opencode/script/build.ts --single \
    && mkdir -p /home/opencode/.opencode/bin \
    && cp /tmp/opencode/packages/opencode/dist/opencode-*/bin/opencode /home/opencode/.opencode/bin/opencode \
    && chmod +x /home/opencode/.opencode/bin/opencode \
    && rm -rf /tmp/opencode \
    && /home/opencode/.opencode/bin/opencode --version

# Add opencode to PATH
ENV PATH="/home/opencode/.opencode/bin:${PATH}"
```

## Platform Detection

The build script automatically detects the platform and builds for the correct architecture. The `--single` flag builds only for the current platform, which is perfect for Docker images.

The build output will be in:
```
/tmp/opencode/packages/opencode/dist/opencode-<os>-<arch>/bin/opencode
```

Where `<os>-<arch>` will be something like:
- `linux-x64` (Linux x86_64)
- `linux-arm64` (Linux ARM64)
- `darwin-x64` (macOS Intel)
- `darwin-arm64` (macOS Apple Silicon)

The wildcard `opencode-*/bin/opencode` will match the correct platform automatically.

## Build Time Optimization

To reduce Docker build time, you can:

1. **Use BuildKit cache mounts** (if using Docker BuildKit):
```dockerfile
RUN --mount=type=cache,target=/home/opencode/.bun/install/cache \
    --mount=type=cache,target=/tmp/opencode/node_modules \
    git clone --depth 1 --branch dev https://github.com/pRizz/opencode.git /tmp/opencode \
    && cd /tmp/opencode \
    && bun install --frozen-lockfile \
    && bun run packages/opencode/script/build.ts --single \
    && mkdir -p /home/opencode/.opencode/bin \
    && cp /tmp/opencode/packages/opencode/dist/opencode-*/bin/opencode /home/opencode/.opencode/bin/opencode \
    && chmod +x /home/opencode/.opencode/bin/opencode \
    && rm -rf /tmp/opencode
```

2. **Pin to a specific commit** to avoid unnecessary rebuilds when the branch updates:
```dockerfile
ARG OPENCODE_COMMIT=abc123def4567890abcdef1234567890abcdef12
RUN git clone https://github.com/pRizz/opencode.git /tmp/opencode \
    && cd /tmp/opencode \
    && git checkout "$OPENCODE_COMMIT" \
    && bun install --frozen-lockfile \
    && bun run packages/opencode/script/build.ts --single \
    && mkdir -p /home/opencode/.opencode/bin \
    && cp /tmp/opencode/packages/opencode/dist/opencode-*/bin/opencode /home/opencode/.opencode/bin/opencode \
    && chmod +x /home/opencode/.opencode/bin/opencode \
    && rm -rf /tmp/opencode
```

## Troubleshooting

### Build Fails with "Command not found: bun"

Ensure Bun is installed and in PATH before building:
```dockerfile
# Verify bun is available
RUN which bun && bun --version
```

### Build Fails with Missing Dependencies

The fork may have additional dependencies. Check if the fork's `package.json` or `bun.lock` differs from upstream:
```dockerfile
# Install all dependencies including dev dependencies (needed for build)
RUN bun install --frozen-lockfile
```

### Binary Not Found After Build

Check the build output location:
```dockerfile
# Debug: List build output
RUN ls -la /tmp/opencode/packages/opencode/dist/
RUN find /tmp/opencode/packages/opencode/dist -name opencode -type f
```

### Wrong Platform Binary

If building on a different platform (e.g., building Linux binary on macOS), you may need to use cross-compilation or build in a Linux container. The `--single` flag builds for the current platform only.

## Alternative: Multi-Stage Build

For even better optimization, use a multi-stage build to separate the build environment from the runtime:

```dockerfile
# -----------------------------------------------------------------------------
# Stage: Build opencode
# -----------------------------------------------------------------------------
FROM ubuntu:24.04 AS opencode-builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Clone and build
RUN git clone --depth 1 --branch dev https://github.com/pRizz/opencode.git /tmp/opencode \
    && cd /tmp/opencode \
    && bun install --frozen-lockfile \
    && bun run packages/opencode/script/build.ts --single

# -----------------------------------------------------------------------------
# Stage: Runtime (your existing Dockerfile continues here)
# -----------------------------------------------------------------------------
FROM ubuntu:24.04 AS runtime

# ... existing setup ...

# Copy opencode binary from builder
COPY --from=opencode-builder /tmp/opencode/packages/opencode/dist/opencode-*/bin/opencode /home/opencode/.opencode/bin/opencode
RUN chmod +x /home/opencode/.opencode/bin/opencode

ENV PATH="/home/opencode/.opencode/bin:${PATH}"
```

## Verification

After installation, verify it works:

```dockerfile
# Verify installation
RUN /home/opencode/.opencode/bin/opencode --version

# Test that it's in PATH
RUN opencode --version

# Verify it's the fork (check for auth features if they add a --fork flag)
RUN opencode --help | grep -i auth || echo "Fork installed successfully"
```

## Summary

**Recommended approach for opencode-cloud Dockerfile:**

1. Use **Method 1** (Build from Source) for reliability
2. Pin to a specific commit using `ARG OPENCODE_COMMIT` for reproducibility
3. Use BuildKit cache mounts to speed up rebuilds
4. Consider multi-stage build if build dependencies are large

This ensures you always get the fork with authentication features, regardless of whether releases are published.
