# Multi-stage Dockerfile for Claxedo Gateway
# Build: docker build -f claxedo/Dockerfile .
ARG BUN_VERSION=1.3.5

# ─────────────────────────────────────────────────────────────
# Stage 1: Dependencies
# ─────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS deps

WORKDIR /app

# Copy workspace configuration first (changes least frequently)
COPY package.json bun.lock turbo.json ./
COPY patches/ ./patches/

# Copy ONLY workspace package.json files in the claxedo dependency chain
# (app, claxedo-app, ui, app-shared, util, sdk/js — no desktop/opencode/console/etc.)
COPY packages/app/package.json ./packages/app/
COPY packages/app-shared/package.json ./packages/app-shared/
COPY packages/claxedo-app/package.json ./packages/claxedo-app/
COPY packages/ui/package.json ./packages/ui/
COPY packages/util/package.json ./packages/util/
COPY packages/sdk/js/package.json ./packages/sdk/js/
# claxedo backend (not a workspace member, installed separately)
COPY claxedo/package.json ./claxedo/

# Stub out workspace packages not in the claxedo dependency chain
# (bun.lock references all workspace members; stubs prevent resolution errors
#  without installing any of their actual dependencies)
RUN for pkg in desktop enterprise function opencode plugin script web slack; do \
      mkdir -p "packages/$pkg" && \
      echo "{\"name\":\"@opencode-ai/$pkg\",\"private\":true}" > "packages/$pkg/package.json"; \
    done && \
    for pkg in app core function mail resource; do \
      mkdir -p "packages/console/$pkg" && \
      echo "{\"name\":\"@opencode-ai/console-$pkg\",\"private\":true}" > "packages/console/$pkg/package.json"; \
    done

# Install dependencies with cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install && \
    cd claxedo && bun install

# ─────────────────────────────────────────────────────────────
# Stage 2: Build Frontend
# ─────────────────────────────────────────────────────────────
FROM deps AS frontend-builder

# Copy source code for frontend packages
COPY packages/ ./packages/

# Build args for VITE_ env vars (baked at build time)
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL

ENV CLAXEDO_OVERRIDES=1

WORKDIR /app/packages/claxedo-app
RUN bun run build

# ─────────────────────────────────────────────────────────────
# Stage 3: Build Backend
# ─────────────────────────────────────────────────────────────
FROM deps AS backend-builder

# Copy only backend source
COPY claxedo/src/ ./claxedo/src/
COPY claxedo/scripts/ ./claxedo/scripts/
COPY claxedo/convex/ ./claxedo/convex/

WORKDIR /app/claxedo

# Run fetch-models with bun directly (avoids tsx issues)
# This generates src/generated/models-data.json and models-types.ts
RUN bun run ./scripts/fetch-models.ts

# Note: No tsc needed - bun runs TypeScript directly at runtime

# ─────────────────────────────────────────────────────────────
# Stage 4: Production Runtime
# ─────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS runtime

# Install curl for health checks and clean up in same layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

# Create non-root user with specific UID/GID
RUN groupadd --gid 1001 claxedo && \
    useradd --uid 1001 --gid claxedo --shell /bin/bash --create-home claxedo

WORKDIR /app

# Copy dependencies with correct ownership
COPY --from=deps --chown=claxedo:claxedo /app/node_modules ./node_modules
COPY --from=deps --chown=claxedo:claxedo /app/claxedo/node_modules ./claxedo/node_modules

# Copy built frontend
COPY --from=frontend-builder --chown=claxedo:claxedo /app/packages/claxedo-app/dist ./public

# Copy backend source (bun runs TypeScript directly)
COPY --from=backend-builder --chown=claxedo:claxedo /app/claxedo/src ./claxedo/src
COPY --from=backend-builder --chown=claxedo:claxedo /app/claxedo/convex ./claxedo/convex
COPY --from=backend-builder --chown=claxedo:claxedo /app/claxedo/package.json ./claxedo/

# Environment configuration
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/public

# Switch to non-root user
USER claxedo

EXPOSE 8080

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["bun", "run", "/app/claxedo/src/server/index.ts"]
