# packages/cloudsession

Cloudflare Worker that stores and serves shared OpenCode agent sessions. Provides a JSON API for the CLI and server-rendered HTML views for browsers.

## Build / Test / Deploy

```bash
# Run all tests (40 tests across 3 files)
bun test --preload ./src/preload.ts src/**/*.test.ts

# Run specific test suites
bun test --preload ./src/preload.ts src/api.test.ts
bun test --preload ./src/preload.ts src/storage.test.ts
bun test --preload ./src/preload.ts src/index.test.ts

# Typecheck
bun tsc --noEmit

# Deploy (requires CLOUDFLARE_API_TOKEN and wrangler secret for SESSIONS_SHARED_SECRET)
CLOUDFLARE_API_TOKEN=... bunx wrangler deploy

# Local dev
bunx wrangler dev
```

The `--preload ./src/preload.ts` flag is required because bun:test needs a mock for the `cloudflare:workers` module (used by the Durable Object import).

## Architecture

```
CLI (packages/opencode)                    Browser
  |                                          |
  |  POST /api/share                         |  GET /sessions          (HTML list)
  |  POST /api/share/:id/sync               |  GET /share/:id         (HTML detail)
  |  DELETE /api/share/:id                   |  GET /ws/:id            (WebSocket)
  |                                          |
  +----------> Hono app (src/index.tsx) <----+
                  |            |
                  v            v
           R2 Bucket    Durable Object
           (storage)    (SessionBroadcast)
```

**Hono** handles all HTTP routing. **R2** stores session data. A **Durable Object** (`SessionBroadcast`) manages WebSocket connections for live updates -- when the CLI syncs new data, the DO broadcasts it to connected browser viewers.

## R2 Storage Layout

The R2 bucket (`opencode-sessions`) uses two key prefixes:

| Prefix        | Type           | Purpose                                                      |
| ------------- | -------------- | ------------------------------------------------------------ |
| `share/${id}` | `AgentSession` | Full session blob (messages, parts, diffs, models, metadata) |
| `index/${id}` | `SessionIndex` | Lightweight metadata (title, counts, timestamps)             |

**Why dual storage?** Workers have a 128MB memory limit. Loading every full `AgentSession` blob just to list sessions hits that limit at ~80 sessions. The `index/` prefix stores only the fields needed for listing, so `GET /sessions` and `GET /api/sessions` stay lightweight.

Both prefixes are written on every `POST /api/share` (create) and `POST /api/share/:id/sync` (update), and both are deleted on `DELETE /api/share/:id`.

## API Routes

| Method | Path                      | Auth          | Description                                        |
| ------ | ------------------------- | ------------- | -------------------------------------------------- |
| POST   | `/api/share`              | none          | Create a new share, returns `{ id, url, secret }`  |
| POST   | `/api/share/:id/sync`     | secret (body) | Sync session data, broadcasts to WebSocket viewers |
| GET    | `/api/share/:id`          | none          | Get full `AgentSession` blob                       |
| GET    | `/api/share/:id/metadata` | none          | Get `SessionIndex` entry                           |
| DELETE | `/api/share/:id`          | secret (body) | Delete session and index                           |
| GET    | `/api/sessions`           | none          | List all sessions (from index prefix)              |

## HTML Routes

| Method | Path         | Description                                  |
| ------ | ------------ | -------------------------------------------- |
| GET    | `/`          | Redirects to `/sessions`                     |
| GET    | `/sessions`  | Session list with client-side search         |
| GET    | `/share/:id` | Session detail with markdown rendering       |
| GET    | `/ws/:id`    | WebSocket upgrade, proxied to Durable Object |

Views use Hono JSX (server-rendered). Inline CSS, no external stylesheets. Dark theme (#0a0a0a background, #6ee7b7 accent). The session detail page includes an inline `<script>` that connects to `/ws/:id` for live updates.

## File Structure

```
src/
  index.tsx          Main Hono app (API + HTML routes, DO re-export)
  types.ts           Type definitions (AgentSession, SessionIndex, SyncData, etc.)
  storage.ts         R2 StorageAdapter (generic, typed) + MockStorageAdapter for tests
  broadcast.ts       SessionBroadcast Durable Object (WebSocket hibernation API)
  preload.ts         Test preload mock for cloudflare:workers module
  api.test.ts        API endpoint tests (28 tests)
  index.test.ts      Original tests
  storage.test.ts    Storage adapter tests
  views/
    layout.tsx       Base HTML layout component
    session-list.tsx Session list page
    session-detail.tsx Session detail with marked for markdown
    not-found.tsx    404 page
script/
  backfill-index.ts  One-time migration: backfills index/ entries from share/ blobs via S3 API
wrangler.jsonc       Worker config (R2, DO bindings, migrations, routes)
```

## Types

Types are defined in `src/types.ts`. SDK types (`Session`, `Message`, `Part`, `FileDiff`, `Model`) are re-exported from `@opencode-ai/sdk/v2`.

Key local types:

- `AgentSession` -- full session blob stored at `share/${id}`
- `SessionIndex` -- lightweight index entry stored at `index/${id}`
- `SessionMetadata` -- internal metadata (secret, syncCount, timestamps)
- `SyncData` -- discriminated union for sync payloads
- `SyncInfo` / `ShareCredentials` -- share creation response types

## Relationship to Other Packages

- **`packages/opencode`** -- the CLI. `src/share/share-next.ts` calls `POST /api/share` and `POST /api/share/:id/sync` to create and update shared sessions.
- **`packages/sdk`** -- provides `@opencode-ai/sdk/v2` types (`Session`, `Message`, `Part`, `FileDiff`, `Model`) that this package depends on. If SDK types change upstream, `src/types.ts` re-exports may need updating.

This package is **fork-only** -- it does not exist in the upstream repo (`anomalyco/opencode`). Merges from upstream will not conflict with files in `packages/cloudsession/`, but SDK type changes in `packages/sdk/` could break the build.

## Environment & Secrets

| Binding                  | Type         | Source                | Description                                                     |
| ------------------------ | ------------ | --------------------- | --------------------------------------------------------------- |
| `SESSIONS_STORE`         | R2 Bucket    | wrangler.jsonc        | R2 bucket `opencode-sessions`                                   |
| `SESSIONS_SHARED_SECRET` | Secret       | `wrangler secret put` | Used to derive per-session secrets via UUIDv5                   |
| `API_DOMAIN`             | Var          | wrangler.jsonc        | Base URL for share links (not including proto, ie. "https://" ) |
| `SESSIONS_BROADCAST`     | DO Namespace | wrangler.jsonc        | Durable Object binding for `SessionBroadcast`                   |

Secrets are managed with `wrangler secret put SESSIONS_SHARED_SECRET`. The CLOUDFLARE_API_TOKEN for deploy is stored externally (GNU pass).

## Cloudflare Notes

- **Bot Fight Mode / WAF**: Must be disabled or have a skip rule for the domain. Cloudflare's managed challenge pages will block programmatic access (CLI fetches, curl) with 403s.
- **Durable Object migrations**: Defined in `wrangler.jsonc` under `migrations`. The `SessionBroadcast` class uses `new_sqlite_classes` (required for hibernation API). New DO classes need a new migration tag.
- **Routes**: Worker is bound to the configured domain via Cloudflare's zone route, with `workers_dev: false` and `preview_urls: false`.

## Upstream Sync

```bash
git remote add upstream https://github.com/anomalyco/opencode.git  # if not already added
git fetch upstream
git merge upstream/dev
```

Since `packages/cloudsession/` is fork-only, upstream merges won't touch this directory. Watch for:

- Changes to `@opencode-ai/sdk` types in `packages/sdk/` -- could break imports in `src/types.ts`
- Changes to `bun.lock` or root `package.json` -- may need conflict resolution
- Changes to the share protocol in `packages/opencode/src/share/` -- API contract may need updating

## Code Style

Follow the root `AGENTS.md` style guide:

- No `else` statements, prefer early returns
- No `any` type (except Zod `z.any()` for pass-through sync data validation)
- No `let`, prefer `const` with ternaries
- No unnecessary destructuring, use dot notation
- Single-word variable names where possible
- Functional array methods (`filter`, `map`, `flatMap`) over loops
- Inline values used only once
