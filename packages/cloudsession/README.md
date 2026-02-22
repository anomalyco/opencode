# OpenCode Sessions API

A Hono-based Cloudflare Worker API server for storing and managing OpenCode agent sessions in R2 object storage.

## Overview

This package provides an API server that:

- Receives sync messages from the OpenCode share-next.ts API
- Destructures sync messages into complete agent sessions
- Stores sessions in Cloudflare R2 object storage
- Returns sessions as typed cryptobject types

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────┐
│  OpenCode CLI   │────────▶│  Sessions API    │────────▶│  R2 Bucket  │
│  (share-next)   │  sync   │  (Hono Worker)   │  store  │  (Sessions) │
└─────────────────┘         └──────────────────┘         └─────────────┘
```

## API Endpoints

### Create Share

**POST** `/api/share`

Create a new share for a session.
The URL returned is used by the client to link to the sessions web view.

**Request:**

```json
{
  "sessionID": "01HMXYZ123..."
}
```

**Response:**

```json
{
  "id": "01HMXYZ456...",
  "url": "https://opencode.web.com/share/01HMXYZ456...",
  "secret": "01HMXYZ789..."
}
```

### Sync Data

**POST** `/api/share/:id/sync`

Synchronize data updates to a share.

**Request:**

```json
{
  "secret": "01HMXYZ789...",
  "data": [
    { "type": "session", "data": { ... } },
    { "type": "message", "data": { ... } },
    { "type": "part", "data": { ... } },
    { "type": "session_diff", "data": [ ... ] },
    { "type": "model", "data": [ ... ] }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "syncCount": 42
}
```

### Get Session

**GET** `/api/share/:id`

Retrieve a complete agent session.

**Response:**

```json
{
  "session": { ... },
  "messages": [ ... ],
  "parts": [ ... ],
  "diffs": [ ... ],
  "models": [ ... ],
  "metadata": {
    "lastUpdated": 1234567890,
    "syncCount": 42
  }
}
```

### Get Session Metadata

**GET** `/api/share/:id/metadata`

Get session metadata without full session data.

**Response:**

```json
{
  "sessionID": "01HMXYZ123...",
  "title": "Fix authentication bug",
  "messageCount": 10,
  "partCount": 45,
  "diffCount": 3,
  "modelCount": 2,
  "lastUpdated": 1234567890,
  "syncCount": 42
}
```

### Delete Share

**DELETE** `/api/share/:id`

Delete a share and its associated session data.

**Request:**

```json
{
  "secret": "01HMXYZ789..."
}
```

**Response:**

```json
{
  "success": true
}
```

### List Sessions

**GET** `/api/sessions`

List all sessions (admin endpoint).

**Response:**

```json
{
  "sessions": [
    {
      "id": "01HMXYZ456...",
      "sessionID": "01HMXYZ123...",
      "createdAt": 1234567890
    }
  ],
  "count": 1
}
```

## Data Types

### AgentSession

The complete agent session structure returned from the API:

```typescript
type AgentSession = {
  session: Session
  messages: Message[]
  parts: Part[]
  diffs: FileDiff[]
  models: Model[]
  metadata: {
    lastUpdated: number
    syncCount: number
  }
}
```

### SyncData

Discriminated union type for sync messages:

```typescript
type SyncData =
  | { type: "session"; data: Session }
  | { type: "message"; data: Message }
  | { type: "part"; data: Part }
  | { type: "session_diff"; data: FileDiff[] }
  | { type: "model"; data: Model[] }
```

See `src/types.ts` for complete type definitions.

## Storage Structure

Data is stored in R2 with the following key structure:

```
credentials/{shareID}  - Share credentials and metadata
sessions/{shareID}     - Complete agent session data
```

## Development

### Prerequisites

- Bun 1.3.5+
- Wrangler CLI
- Cloudflare account with R2 enabled

### Setup

1. Install dependencies:

```bash
bun install
```

2. Create R2 bucket:

```bash
wrangler r2 bucket create opencode-sessions
```

3. Set the shared secret (used to generate share tokens):

```bash
# Generate a UUID and set it as the secret
wrangler secret put SESSIONS_SHARED_SECRET
# Enter a UUID v4, e.g.: 11111111-1111-1111-1111-111111111111

# Or using pass:
wrangler secret put $(pass show opencode/sessions_shared_secret)
```

For local development, create a `.dev.vars` file:

```
SESSIONS_SHARED_SECRET=your-uuid-token-here
SESSIONS_RPC_SHARED_KEY=your-uuid-token-here

```

4. Run locally:

```bash
bun run dev
```

5. Run tests:

```bash
bun test           # All tests
bun run test:api   # API contract tests only
```

6. Type check:

```bash
bun run typecheck
```

### Deployment

1. Deploy to Cloudflare Workers:

```bash
bun run deploy
```

2. Configure DNS for custom domain (optional):

```bash
# Add route in wrangler.jsonc or via Cloudflare dashboard
```

## Environment Variables

- `API_DOMAIN`: The domain where the API is hosted.

This will be setup in the cloudflare dashboard.

## Secrets

- `SESSIONS_SHARED_SECRET`: UUID v4 used as the namespace for generating deterministic share secrets via UUID v5.

Set via `wrangler secret put`.

## R2 Bindings

- `SESSIONS_STORE`: R2 bucket for storing session data

## Integration with OpenCode

This API is designed to work with the `share-next.ts` module in the main OpenCode application. The share-next module will:

1. Create a share using `POST /api/share`
2. Automatically sync session updates using `POST /api/share/:id/sync`
3. Delete shares when needed using `DELETE /api/share/:id`

Users can then retrieve their sessions using the share URL.
