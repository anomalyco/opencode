## Build/Test/Lint

- `bun dev` - Run local development with Wrangler
- `wrangler dev` - Test against local Cloudflare environment
- `wrangler deploy` - Deploy to Cloudflare Workers
- No test framework - use manual testing or curl for endpoints

## Tech Stack

- **Hono** - Lightweight TypeScript web framework for Cloudflare Workers
- **Durable Objects** - For session state management and WebSocket handling
- **R2 Storage** - For persistent session data storage
- **Cloudflare Workers** - Serverless compute platform
- **TypeScript** - strict mode enabled

## Code Style

- Use async/await for async operations
- Keep functions focused on single responsibilities
- Use Hono middleware for cross-cutting concerns
- Store critical data in both Durable Objects (for speed) and R2 (for durability)
- Use JSON serialization for all R2 storage
- Validate sessionID and secrets before any storage operations
- Avoid try/catch where possible; use explicit error handling
- Prefer single-word variable names where applicable

## Key Patterns

### Session ID Handling

- Full sessionID passed in request bodies
- Short names (8-char suffix) derived using `SyncServer.shortName()`
- Short names used for URL-friendly share links and Durable Object IDs

### Data Persistence

- Durable Object storage for real-time state
- R2 for long-term persistence and backup
- Metadata synced to both stores for resilience

### WebSocket Pattern

- Durable Objects handle WebSocket connections via `/share_poll`
- On connection, send all stored session data to client
- New updates broadcast to all connected clients

## Context

- Part of OpenCode session sharing infrastructure
- Designed to scale horizontally via Durable Object partitioning
- Session data lifetime matches Durable Object lifetime (auto-cleanup possible)
- No authentication required (relies on secret tokens)
- Admin endpoints require separate admin secret for operational tasks

## Cloudflare Integration

- **Durable Objects:** Binding name `SYNC_SERVER` with namespace `SyncServer`
- **R2 Bucket:** Binding name `Bucket` for persistent storage
- **Environment:** Development uses `localhost`, production uses configured domain
- **Security:** Secrets stored via `wrangler secret put` (never in code)

## Common Tasks

### Adding a new endpoint

1. Add route to Hono app (`.post()`, `.get()`, etc.)
2. Validate required query/body parameters
3. Get or create Durable Object stub via `SyncServer.idFromName()`
4. Call appropriate stub methods
5. Return JSON response with proper error codes

### Modifying metadata tracking

1. Update `SyncServer.updateMetadata()` method
2. Ensure R2 metadata files are updated in parallel
3. Test with `POST /migrate_metadata` if adding new fields

### Debugging WebSocket issues

1. Check browser console for connection errors
2. Use `wrangler tail` to view worker logs
3. Verify `WEB_DOMAIN` environment variable matches actual domain
4. Check Durable Object state in wrangler dashboard
