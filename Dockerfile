# ── Build stage ────────────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy workspace manifest files first for better layer caching
COPY package.json bun.lock* ./
COPY packages/collab/package.json ./packages/collab/
COPY packages/core/package.json ./packages/core/
COPY packages/llm/package.json ./packages/llm/
COPY packages/opencode/package.json ./packages/opencode/
COPY packages/app/package.json ./packages/app/
COPY packages/ui/package.json ./packages/ui/
COPY packages/sdk/js/package.json ./packages/sdk/js/

RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build the app (SolidJS → static)
RUN bun run --cwd packages/app build 2>/dev/null || true

# Build the opencode server binary
RUN bun run --cwd packages/opencode build 2>/dev/null || true

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM oven/bun:1.3

WORKDIR /app

# Install git (needed for server-side workspace cloning)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy built artifacts from builder
COPY --from=builder /app /app

# Create workspace directory for collab session repos
RUN mkdir -p /var/opencode/workspaces

# Data directory for SQLite database
RUN mkdir -p /root/.local/share/opencode

ENV NODE_ENV=production
ENV OPENCODE_BASE_URL=http://localhost:4096

EXPOSE 4096

# Start opencode server
CMD ["bun", "run", "--cwd", "packages/opencode", "src/index.ts"]
