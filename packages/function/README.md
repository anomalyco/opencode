# OpenCode Function - Session Sync Worker

## Project Structure

- **Framework:** Hono (lightweight web framework for Cloudflare Workers)
- **Deployment:** Cloudflare Workers + Durable Objects + R2
- **Type Safety:** TypeScript strict mode
- **Storage:** R2 buckets for session data persistence
- **Real-time:** WebSocket support via Durable Objects

## Key Components

### SyncServer (Durable Object)

- Manages real-time WebSocket connections for session synchronization
- Stores session data in Durable Object storage
- Persists messages and metadata to R2 buckets
- Handles session sharing with secret-based access
- Supports session metadata tracking (message count, token usage, timestamps)

### API Endpoints

- `POST /share_create` - Create a shareable session with secret token
- `POST /share_delete` - Delete session (requires valid secret)
- `POST /share_delete_admin` - Admin deletion endpoint (requires admin secret)
- `POST /share_sync` - Sync session data (messages, parts, info)
- `GET /share_poll` - WebSocket endpoint for real-time updates
- `GET /share_data` - Fetch complete session data
- `GET /sessions_list` - List all shared sessions with metadata
- `POST /migrate_metadata` - Admin endpoint for metadata migration

## Development Commands

```bash
bun dev              # Local dev with hot reload
bun build            # Build for Cloudflare Workers
wrangler dev         # Test against local Cloudflare environment
```

## Environment Variables

- **SYNC_SERVER** - Durable Object namespace reference
- **Bucket** - R2 bucket for session storage
- **WEB_DOMAIN** - Domain for share URLs (CORS origin)
- **ADMIN_SECRET** - Secret key for admin operations

## Data Structure

### Session Metadata

```typescript
{
  id: string // Short name (last 8 chars of sessionID)
  sessionID: string // Full session identifier
  title: string // Session title
  directory: string // Working directory
  messageCount: number // Total messages in session
  inputTokens: number // Total input tokens used
  outputTokens: number // Total output tokens used
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}
```

### Message Structure (in Durable Storage)

```
session/info/{sessionID}           // Session metadata
session/message/{sessionID}/{id}   // Individual messages
session/part/{sessionID}/{partId}  // Message parts (streaming)
```

## Cloudflare Configuration (wrangler.jsonc)

- **Durable Objects:** SyncServer binding for session management
- **R2 Bindings:** Bucket configuration for persistent storage
- **Routes:** Specific routes for session sharing endpoints
- **Secrets:** Admin credentials and domain configuration

## Agent Reminders

- Always check `wrangler.jsonc` for current bindings and environment setup
- Session data is stored in R2 with prefix `share/` for accessibility
- Metadata is synced to R2 for quick listing without Durable Object access
- WebSocket connections are managed per session ID via SyncServer instances
- Short names (8-char suffix) are used for URL-friendly share links
- Ensure `WEB_DOMAIN` is properly configured for CORS on share endpoints

## Architecture Overview

```
Client (web) → /share_poll (WebSocket) → SyncServer (Durable Object)
                                              ↓
                                         R2 Storage
                                              ↓
                                         Durable Storage
```

Real-time updates flow through WebSocket, while historical data is served from R2 and Durable storage.
