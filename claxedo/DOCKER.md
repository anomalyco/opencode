# Claxedo Docker Configuration

## Overview

This document explains the Docker setup for Claxedo Gateway and documents lessons learned during configuration.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Multi-Stage Build                        │
├─────────────────────────────────────────────────────────────┤
│  Stage 1: deps            - Install all workspace deps      │
│  Stage 2: frontend-builder - Build claxedo-app (Vite)       │
│  Stage 3: backend-builder  - Generate models, copy source   │
│  Stage 4: runtime          - Minimal production image       │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
opencode/                    # Monorepo root (Docker build context)
├── .dockerignore           # Root-level ignore (CRITICAL location)
├── package.json            # Workspace root with all package refs
├── bun.lock                # Lockfile
├── packages/               # Frontend packages
│   └── claxedo-app/        # Vite frontend app
└── claxedo/
    ├── Dockerfile          # Multi-stage build
    ├── docker-compose.yml  # Local dev/testing
    ├── .env.example        # Environment template
    ├── src/                # TypeScript source (runs directly with bun)
    ├── convex/             # Convex schema + generated files
    └── scripts/            # Build scripts (fetch-models.ts)
```

## Quick Start

```bash
# From claxedo/ directory
cp .env.example .env.local
# Edit .env.local with your values

docker compose --env-file .env.local up --build
```

## Dockerfile Breakdown

### Stage 1: Dependencies (`deps`)

```dockerfile
FROM oven/bun:${BUN_VERSION} AS deps

# Native modules (node-pty) require build tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 make g++ nodejs npm && \
    npm install -g node-gyp

# Copy ALL workspace package.json files
# Bun workspaces require every referenced package to exist
COPY package.json bun.lock turbo.json ./
COPY packages/*/package.json ...
COPY claxedo/package.json ./claxedo/

# Install workspace deps, then claxedo-specific deps
RUN bun install && cd claxedo && bun install
```

**Key Points:**
- Must copy ALL workspace package.json files referenced in root package.json
- `node-gyp` needed for native modules like `node-pty`
- Run `bun install` twice: once for workspace, once for claxedo

### Stage 2: Frontend Builder (`frontend-builder`)

```dockerfile
FROM deps AS frontend-builder

COPY packages/ ./packages/

ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL

ENV CLAXEDO_OVERRIDES=1

WORKDIR /app/packages/claxedo-app
RUN bun run build
```

**Key Points:**
- VITE_ variables must be build args (baked into bundle)
- `CLAXEDO_OVERRIDES=1` enables claxedo-specific UI overrides

### Stage 3: Backend Builder (`backend-builder`)

```dockerfile
FROM deps AS backend-builder

COPY claxedo/src/ ./claxedo/src/
COPY claxedo/scripts/ ./claxedo/scripts/
COPY claxedo/convex/ ./claxedo/convex/

WORKDIR /app/claxedo

# Generate models data (uses bun directly, not tsx)
RUN bun run ./scripts/fetch-models.ts
```

**Key Points:**
- No TypeScript compilation needed - bun runs .ts directly
- `fetch-models.ts` generates `src/generated/models-data.json`
- Must copy `convex/_generated/` for Convex client

### Stage 4: Runtime (`runtime`)

```dockerfile
FROM oven/bun:${BUN_VERSION}-slim AS runtime

# Health check dependency
RUN apt-get update && apt-get install -y --no-install-recommends curl

# Non-root user (UID 1001)
RUN groupadd --gid 1001 claxedo && \
    useradd --uid 1001 --gid claxedo claxedo

# Copy artifacts with correct ownership
COPY --from=deps --chown=claxedo:claxedo /app/node_modules ./node_modules
COPY --from=deps --chown=claxedo:claxedo /app/claxedo/node_modules ./claxedo/node_modules
COPY --from=frontend-builder --chown=claxedo:claxedo /app/packages/claxedo-app/dist ./public
COPY --from=backend-builder --chown=claxedo:claxedo /app/claxedo/src ./claxedo/src
COPY --from=backend-builder --chown=claxedo:claxedo /app/claxedo/convex ./claxedo/convex

USER claxedo
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/global/health || exit 1

CMD ["bun", "run", "/app/claxedo/src/server/index.ts"]
```

**Key Points:**
- Use `-slim` variant for smaller image
- Copy BOTH `node_modules` (root hoisted + claxedo-specific)
- `--chown` on COPY for correct file ownership
- Health check endpoint must exist in your app

## Docker Compose

```yaml
services:
  claxedo:
    build:
      context: ..          # Monorepo root
      dockerfile: claxedo/Dockerfile
      args:
        - VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
        - VITE_CONVEX_URL=${VITE_CONVEX_URL}
    environment:
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY}  # Runtime secrets
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/global/health"]
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
```

## Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Build-time | Clerk public key (baked into frontend) |
| `VITE_CONVEX_URL` | Build-time | Convex deployment URL |
| `CLERK_SECRET_KEY` | Runtime | Clerk secret (server-side only) |
| `DAYTONA_API_KEY` | Runtime | Daytona sandbox API key |
| `ENCRYPTION_KEY` | Runtime | Session encryption key |

---

# Lessons Learned

## Issue 1: .dockerignore Location

**Problem:** `.dockerignore` was placed in `claxedo/` but build context was `..` (monorepo root).

**Symptom:** All files included in build context, slow builds, excluded packages still present.

**Solution:** Place `.dockerignore` at the build context root (monorepo root).

```bash
# Wrong
claxedo/.dockerignore  # Ignored when context is parent

# Correct
.dockerignore          # At monorepo root
```

## Issue 2: Workspace Package Resolution

**Problem:** Only copied some `package.json` files, but `bun install` failed with "Workspace not found".

**Symptom:**
```
error: Workspace not found "packages/slack"
```

**Solution:** Copy ALL package.json files referenced in root `package.json` workspaces:

```dockerfile
# Must match ALL entries in package.json workspaces
COPY packages/app/package.json ./packages/app/
COPY packages/slack/package.json ./packages/slack/
COPY packages/console/app/package.json ./packages/console/app/
# ... every single one
```

## Issue 3: .dockerignore vs Package.json Conflict

**Problem:** Excluded packages in `.dockerignore` that were referenced in workspace config.

**Symptom:**
```
failed to calculate checksum: "/packages/slack/package.json": not found
```

**Solution:** Only exclude source/dist, not package.json:

```dockerignore
# Wrong - excludes package.json too
packages/slack/

# Correct - only exclude heavy directories
packages/slack/src/
packages/slack/dist/
packages/slack/.turbo/
```

## Issue 4: Lockfile Out of Sync

**Problem:** `--frozen-lockfile` failed because lockfile didn't match package.json.

**Symptom:**
```
error: lockfile had changes, but lockfile is frozen
```

**Solution:** Update lockfile locally before building, or remove flag for dev:

```bash
# Local: update lockfile
bun install
git add bun.lock && git commit -m "Update lockfile"

# Or in Dockerfile (dev only):
RUN bun install  # Without --frozen-lockfile
```

## Issue 5: Native Module Compilation

**Problem:** `node-pty` requires native compilation but build tools missing.

**Symptom:**
```
/usr/bin/bash: line 1: node-gyp: command not found
```

**Solution:** Install build toolchain in deps stage:

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 make g++ nodejs npm && \
    npm install -g node-gyp
```

## Issue 6: tsx vs Bun for Scripts

**Problem:** `npx tsx` doesn't work reliably in bun containers.

**Symptom:**
```
error: Cannot find module './cjs/index.cjs'
```

**Solution:** Run TypeScript directly with bun:

```dockerfile
# Wrong
RUN bun run build  # If build script uses "npx tsx"

# Correct
RUN bun run ./scripts/fetch-models.ts  # Direct bun execution
```

## Issue 7: Module Resolution in Runtime

**Problem:** Bun couldn't find modules when running from `/app/claxedo/src/`.

**Symptom:**
```
Cannot find module '@hono/node-server' from '/app/claxedo/src/server/index.ts'
```

**Root Cause:** Bun resolves modules relative to the script location. With monorepo hoisting, dependencies land in `/app/node_modules`, but bun looks in `/app/claxedo/node_modules` first.

**Solution:** Copy both node_modules directories:

```dockerfile
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/claxedo/node_modules ./claxedo/node_modules
```

## Issue 8: Missing Generated Files

**Problem:** Convex generated files not copied to runtime.

**Symptom:**
```
Cannot find module '../../convex/_generated/api.js'
```

**Solution:** Copy convex directory including `_generated/`:

```dockerfile
COPY --from=backend-builder /app/claxedo/convex ./claxedo/convex
```

## Issue 9: OpenTelemetry Version Incompatibility

**Problem:** `@opentelemetry/semantic-conventions` v1.39.0 changed export names.

**Symptom:**
```
Export named 'ATTR_DEPLOYMENT_ENVIRONMENT_NAME' not found
```

**Solution:** Use string constants instead of imports for cross-version compatibility:

```typescript
// Wrong - breaks with version changes
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Correct - stable across versions
const ATTR_SERVICE_NAME = "service.name";
const ATTR_SERVICE_VERSION = "service.version";
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";
```

---

# Debugging Tips

## Inspect Build Stage

```bash
# Build up to a specific stage
docker build --target deps -t debug-deps -f claxedo/Dockerfile ..

# Run shell in that stage
docker run --rm -it debug-deps /bin/sh
```

## Check Container Contents

```bash
docker compose run --rm --entrypoint /bin/sh claxedo -c "ls -la /app/node_modules/@hono/"
```

## View Build Cache

```bash
docker builder prune      # Clear build cache
docker system df          # Check disk usage
```

## Force Rebuild

```bash
docker compose build --no-cache
```

---

# Production Checklist

- [ ] Update `bun.lock` and commit before deploy
- [ ] Add `--frozen-lockfile` back for CI builds
- [ ] Verify health check endpoint exists (`/global/health`)
- [ ] Set resource limits in orchestrator (K8s/Fly.io)
- [ ] Configure secrets via environment (never in image)
- [ ] Test image locally before deploy
- [ ] Scan image for vulnerabilities (`docker scout`)
