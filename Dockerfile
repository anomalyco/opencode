# syntax=docker/dockerfile:1
FROM oven/bun:1.3

WORKDIR /app

# git for server-side repo cloning; build tools for native npm packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 make g++ nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Copy source
COPY . .

# Install — cache mount keeps tarballs between builds, --ignore-scripts skips
# native compilation (tree-sitter/pty) so the image starts fast;
# those features work fine without native binaries via wasm/fallback.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --no-optional --ignore-scripts

# Build the SolidJS web app (collab features in packages/app/src/pages/collab/)
RUN bun run --cwd packages/app build

# Workspace dirs + opencode config with claude-auth plugin
RUN mkdir -p /var/opencode/workspaces /root/.local/share/opencode /root/.config/opencode && \
    printf '{"plugin":["opencode-claude-auth@latest"]}\n' > /root/.config/opencode/opencode.json

ENV NODE_ENV=production
EXPOSE 4096

CMD ["bun", "run", "--cwd", "packages/opencode", "src/index.ts", "serve", "--port", "4096", "--hostname", "0.0.0.0", "--print-logs"]
