# Claxedo

Cloud-first fork of OpenCode with Convex database, Clerk auth, and Daytona sandboxes.

## Overview

Claxedo extends OpenCode to run entirely in the cloud:
- **Convex** for real-time data storage
- **Clerk** for authentication and organization management
- **Daytona** for isolated code execution sandboxes

## Project Structure

```
claxedo/
├── convex/                         # Convex backend (real-time database)
│   ├── schema.ts                   # Database schema definitions
│   ├── auth.ts                     # Clerk JWT validation config
│   ├── authSession.ts              # Auth session helpers
│   ├── http.ts                     # HTTP route handlers
│   ├── convex.config.ts            # Convex project config
│   ├── projects.ts                 # Project CRUD operations
│   ├── sessions.ts                 # Chat session management
│   ├── workspaces.ts               # Workspace management
│   └── aiCredentials.ts            # Encrypted LLM API keys
│
├── src/
│   ├── clients/                    # External service clients
│   │   ├── convex.ts               # Convex HTTP client wrapper
│   │   └── daytona.ts              # Daytona SDK client wrapper
│   │
│   ├── config/                     # Configuration management
│   │   └── index.ts                # Environment config loader
│   │
│   ├── generated/                  # Auto-generated files
│   │   └── models-data.ts          # LLM provider/model definitions
│   │
│   ├── orchestrator/               # Sandbox lifecycle management
│   │   └── index.ts                # Create/start/stop sandboxes,
│   │                               # inject credentials, manage OpenCode
│   │
│   ├── sandboxes/                  # Cloud sandbox abstraction
│   │   ├── index.ts                # Provider-agnostic interfaces
│   │   └── providers/
│   │       └── daytona.ts          # Daytona implementation
│   │
│   ├── server/                     # Hono HTTP gateway server
│   │   ├── index.ts                # Server entry point
│   │   ├── app.ts                  # Hono app setup
│   │   ├── context.ts              # Request context types
│   │   │
│   │   ├── routes/                 # API route handlers
│   │   │   ├── auth.ts             # Auth credential storage
│   │   │   ├── cloud.ts            # Cloud-specific endpoints
│   │   │   ├── global.ts           # Health, events, dispose
│   │   │   ├── opencode.ts         # OpenCode compatibility shims
│   │   │   ├── project.ts          # Project endpoints
│   │   │   ├── provider.ts         # LLM provider listing
│   │   │   ├── session.ts          # Session management
│   │   │   └── workspace.ts        # Workspace endpoints
│   │   │
│   │   ├── proxy/                  # Sandbox proxy layer
│   │   │   ├── workspace.ts        # Route /w/:workspaceId/* to sandbox
│   │   │   ├── websocket.ts        # WebSocket proxy for PTY
│   │   │   ├── headers.ts          # Header manipulation
│   │   │   └── directory.ts        # Directory resolution
│   │   │
│   │   ├── events/                 # Server-sent events
│   │   │   ├── bus.ts              # Event broadcasting
│   │   │   ├── types.ts            # Event type definitions
│   │   │   └── upstream.ts         # Upstream event forwarding
│   │   │
│   │   ├── middleware/             # Hono middleware
│   │   │   ├── cors.ts             # CORS configuration
│   │   │   └── request-id.ts       # Request ID tracking
│   │   │
│   │   └── lib/                    # Server utilities
│   │       ├── logging.ts          # Structured logging
│   │       ├── memoize.ts          # Caching utilities
│   │       ├── lazy.ts             # Lazy initialization
│   │       └── paths.ts            # Path helpers
│   │
│   └── services/                   # Business logic services
│       ├── clerk-jwt.ts            # Clerk JWT verification
│       ├── identity.ts             # User identity resolution
│       ├── credential-sync.ts      # Sync credentials to sandbox
│       ├── models-cache.ts         # LLM models caching
│       ├── project-service.ts      # Project business logic
│       ├── sandbox-preview.ts      # Preview URL generation
│       └── sandbox-resolver.ts     # Resolve session to sandbox
│
├── scripts/                        # Build scripts
│   └── fetch-models.ts             # Fetch models from models.dev
│
├── script/                         # Debug utilities
│   ├── daytona-port-probe.ts       # List listening ports in sandbox
│   └── daytona-preview-test.ts     # Test preview URL generation
│
├── package.json
└── tsconfig.json
```

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up Convex**
   ```bash
   npx convex dev
   ```
   Follow the prompts to create a Convex project.

3. **Configure environment variables**
   ```bash
   # .env.local
   CONVEX_URL=https://your-project.convex.cloud

   # Clerk (set in Convex dashboard)
   CLERK_JWT_ISSUER_DOMAIN=https://your-clerk-domain.clerk.accounts.dev

   # Daytona
   DAYTONA_API_KEY=
   DAYTONA_API_URL=
   DAYTONA_TARGET=

   # Encryption key for AI credentials
   ENCRYPTION_KEY=your-32-char-secret-key
   ```

## Development

```bash
# Start Convex dev server
npm run dev

# Type check
npm run typecheck

# Build
npm run build
```

## License

MIT
