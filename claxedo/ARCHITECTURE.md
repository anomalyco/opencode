# Claxedo Backend Server Architecture

This document provides comprehensive technical documentation for the Claxedo backend server - a reverse proxy gateway that sits between the Claxedo UI and cloud sandboxes.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Directory Structure](#2-directory-structure)
3. [Server & Routes](#3-server--routes)
4. [Proxy System](#4-proxy-system)
5. [Sandbox Providers](#5-sandbox-providers)
6. [Orchestrator](#6-orchestrator)
7. [Convex Integration](#7-convex-integration)
8. [Security & Authentication](#8-security--authentication)
9. [Configuration](#9-configuration)
10. [Data Flow Examples](#10-data-flow-examples)

---

## 1. System Overview

### 1.1 Purpose

The Claxedo backend server provides:

- **Reverse Proxy Gateway**: Routes requests between UI and cloud sandboxes
- **Auto-Wake**: Automatically restarts sleeping sandboxes on access
- **Workspace Orchestration**: End-to-end workspace creation with repo cloning
- **Credential Management**: Encrypted AI provider key storage and injection
- **Real-time PTY**: WebSocket proxy for terminal connections
- **Observability**: Full tracing, metrics, and error tracking

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Claxedo UI (Frontend)                          │
│                          packages/claxedo-app                            │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Claxedo Gateway Server (This)                        │
│                              claxedo/                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Routes    │  │    Proxy    │  │ Orchestrator│  │  Observability  │ │
│  │  (Hono)     │  │ (Dir/WS/WS) │  │  (Sandbox)  │  │ (OTEL/Prom/Sen) │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Convex      │    │     Daytona     │    │      Clerk      │
│   (Database)    │    │   (Sandboxes)   │    │     (Auth)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 1.3 Core Dependencies

| Dependency | Purpose |
|------------|---------|
| **Hono** | Fast, lightweight web framework |
| **Daytona SDK** | Cloud sandbox provider API |
| **Convex** | Backend database & real-time sync |
| **Clerk** | Authentication & JWT verification |
| **OpenTelemetry** | Distributed tracing |
| **prom-client** | Prometheus metrics |
| **Sentry** | Error tracking |

---

## 2. Directory Structure

```
claxedo/
├── src/
│   ├── server/                    # HTTP gateway & routing
│   │   ├── app.ts                # Hono app factory with middleware
│   │   ├── index.ts              # Server entry point
│   │   ├── context.ts            # Hono context types
│   │   ├── middleware/           # Auth, CORS, request tracking
│   │   ├── routes/               # API endpoints
│   │   │   ├── index.ts          # Route registration
│   │   │   ├── workspace.ts      # Workspace CRUD
│   │   │   ├── project.ts        # Project management
│   │   │   ├── session.ts        # Chat sessions
│   │   │   ├── backend.ts        # User backends (tunnel)
│   │   │   └── agent-hook.ts     # CLI agent callbacks
│   │   ├── proxy/                # Reverse proxies
│   │   │   ├── directory.ts      # Directory-based proxy
│   │   │   ├── workspace.ts      # Workspace-based proxy
│   │   │   └── websocket.ts      # WebSocket PTY proxy
│   │   ├── lib/                  # Utilities
│   │   └── events/               # Event bus
│   │
│   ├── orchestrator/             # Sandbox lifecycle management
│   │   └── index.ts              # SandboxOrchestrator
│   │
│   ├── sandboxes/                # Cloud sandbox abstractions
│   │   ├── index.ts              # CloudSandbox interface
│   │   └── providers/
│   │       └── daytona.ts        # Daytona implementation
│   │
│   ├── services/                 # Business logic
│   │   ├── sandbox-resolver.ts   # Workspace → sandbox URL
│   │   ├── sandbox-preview.ts    # Daytona preview URLs
│   │   ├── identity.ts           # Clerk JWT resolution
│   │   ├── credential-sync.ts    # AI credential injection
│   │   └── clerk-jwt.ts          # JWT verification
│   │
│   ├── clients/                  # External service clients
│   │   ├── convex.ts             # Convex HTTP client
│   │   └── daytona.ts            # Daytona API wrapper
│   │
│   ├── config/                   # Configuration
│   │   └── index.ts              # Environment config
│   │
│   └── observability/            # Tracing, metrics, errors
│       ├── index.ts              # Main exports
│       ├── config.ts             # Feature flags
│       ├── tracing/              # OpenTelemetry
│       ├── metrics/              # Prometheus
│       └── sentry/               # Error tracking
│
├── convex/                        # Backend database
│   ├── schema.ts                 # Table definitions
│   ├── workspaces.ts             # Workspace queries
│   ├── projects.ts               # Project queries
│   ├── aiCredentials.ts          # Credential storage
│   ├── chat_sessions.ts          # Session metadata
│   └── http.ts                   # HTTP handlers
│
└── package.json
```

---

## 3. Server & Routes

### 3.1 Middleware Stack

The server applies middleware in order:

```typescript
// app.ts
app.use("*", logger())                      // Request logging
app.use("*", requestIdMiddleware())         // Generate request ID
app.use("*", corsMiddleware())              // CORS headers

if (observabilityConfig.otelEnabled)
  app.use("*", tracingMiddleware())         // OpenTelemetry spans
if (observabilityConfig.prometheusEnabled)
  app.use("*", metricsMiddleware())         // HTTP metrics
if (observabilityConfig.sentryEnabled)
  app.use("*", sentryMiddleware())          // Error capture
```

### 3.2 Route Hierarchy

Routes are organized by authentication level:

```
┌─ PUBLIC ROUTES (no auth)
│  ├─ GET  /global/health         → Health check
│  ├─ POST /hook/*                → Agent hook callbacks
│  ├─ GET  /metrics               → Prometheus endpoint
│  └─ GET  /assets/*              → Static files
│
├─ MEMBER ROUTES (requireAuth("member"))
│  ├─ GET  /global/*              → Events, pings, info
│  ├─ GET  /api/workspace/resolve → Resolve workspace URL
│  ├─ GET  /project/*             → List/get projects
│  ├─ POST /project/*             → Create projects
│  ├─ GET  /session/*             → List sessions
│  ├─ GET  /provider/*            → List AI providers
│  └─ PUT  /auth/:provider        → Store credentials
│
├─ ADMIN ROUTES (requireAuth("admin"))
│  ├─ POST /api/workspace/create  → Create workspace
│  └─ POST /api/workspace/wake    → Wake sleeping workspace
│
└─ PROXY ROUTES (requireWorkspaceAccess())
   ├─ ALL  /w/:workspaceId/*      → Workspace proxy
   ├─ WS   /pty/:ptyId/connect    → PTY WebSocket
   └─ ALL  /* (with header)       → Directory proxy
```

### 3.3 Core Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/global/health` | GET | Public | Health check, returns `{ version: "claxedo-gateway" }` |
| `/api/workspace/create` | POST | Admin | Orchestrate new sandbox + workspace |
| `/api/workspace/wake` | POST | Admin | Wake sleeping sandbox |
| `/api/workspace/resolve` | GET | Member | Get workspace upstream URL |
| `/w/:workspaceId/*` | ALL | Member | Proxy to sandbox OpenCode API |
| `/pty/:ptyId/connect` | WS | Member | WebSocket PTY connection |
| `/provider` | GET | Member | List AI providers (with Convex data) |
| `/auth/:provider` | PUT | Member | Store credential (intercepted, stored in Convex) |
| `/metrics` | GET | Public | Prometheus metrics |

---

## 4. Proxy System

### 4.1 Directory Proxy

Handles requests with `x-opencode-directory` header:

```
Request with x-opencode-directory: /workspace/proj-123/main
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│           DirectoryProxyMiddleware                   │
├─────────────────────────────────────────────────────┤
│  1. Extract directory from header/query             │
│  2. Query Convex: workspaces.getByDirectory()       │
│  3. Get workspace → project → organizationId        │
│  4. Verify ownership (FAIL CLOSED)                  │
│  5. Check sandbox status, wake if needed            │
│  6. Get Daytona preview URL                         │
│  7. Proxy request to sandbox                        │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
            Sandbox OpenCode Server
```

**Intercepted Routes:**
- `GET /session` - Served from Convex instead of sandbox
- `PUT /auth/:provider` - Credential stored in Convex
- `GET /provider` - Augmented with Convex credentials

### 4.2 Workspace Proxy

Handles `/w/:workspaceId/*` requests:

```
GET /w/ws-abc-123/agent/list
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│           WorkspaceProxyRoutes                       │
├─────────────────────────────────────────────────────┤
│  1. Extract workspaceId from URL                    │
│  2. Query Convex: workspaces.getById()              │
│  3. Verify organization ownership                   │
│  4. Check sandbox status                            │
│  5. If stopped: wake sandbox (ensureRunning)        │
│  6. Get fresh preview URL                           │
│  7. Proxy request                                   │
└─────────────────────────────────────────────────────┘
```

### 4.3 WebSocket PTY Proxy

Handles real-time terminal connections:

```
ws://gateway/w/:workspaceId/pty/:ptyId/connect?token=JWT
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│           handlePtyUpgrade()                         │
├─────────────────────────────────────────────────────┤
│  1. Parse workspaceId/ptyId from URL                │
│  2. Extract JWT from query params                   │
│  3. Verify JWT signature (Clerk)                    │
│  4. Verify workspace ownership                      │
│  5. Create upstream WebSocket to sandbox            │
│  6. Bidirectional message relay                     │
│  7. Track connection metrics                        │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
         Sandbox PTY Process
```

---

## 5. Sandbox Providers

### 5.1 CloudSandbox Interface

```typescript
interface CloudSandbox {
  readonly id: string
  readonly provider: string

  ensureRunning(): Promise<void>
  exec(cmd: string, options?): Promise<ExecResult>
  spawnPty(options): Promise<PtyHandle>
  getServiceUrl(port: number): Promise<string>
  ensureRepo(repoUrl: string, targetDir: string): Promise<void>
  destroy(): Promise<void>
}
```

### 5.2 Daytona Implementation

The `DaytonaSandbox` class provides full Daytona integration:

**Key Methods:**

| Method | Purpose |
|--------|---------|
| `ensureRunning()` | Create/start sandbox, wait for "started" state |
| `ensureRepo()` | Clone repository into sandbox |
| `ensureOpencodeServer()` | Start OpenCode server with credentials |
| `getServiceUrl()` | Get Daytona signed preview URL |
| `injectCredential()` | PUT API key to OpenCode /auth endpoint |

**Sandbox Creation Flow:**

```
1. Check for existing sandbox (Daytona.get)
2. If exists and running → return
3. If exists and stopped → start()
4. If not exists:
   a. Check for snapshot (faster)
   b. Create from snapshot OR build from image
5. Wait for state === "started"
6. Verify tools available (bash, git, curl)
```

**Environment Variables Injected:**

```
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
GROQ_API_KEY
XAI_API_KEY
MISTRAL_API_KEY
AZURE_OPENAI_API_KEY
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
OPENROUTER_API_KEY
AI_GATEWAY_API_KEY
CLOUDFLARE_API_TOKEN
```

---

## 6. Orchestrator

### 6.1 SandboxOrchestrator

The orchestrator manages end-to-end workspace creation:

```typescript
initOrchestrator({
  daytonaApiKey,      // Daytona API auth
  daytonaApiUrl,      // Daytona endpoint
  daytonaTarget,      // Region
  encryptionKey,      // AES-256-GCM key
  convexUrl,          // Convex database
})
```

### 6.2 createSandbox() Workflow

```
POST /api/workspace/create
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  1. Resolve/Create Project                          │
│     └─ Convex: projects.create() or getByExternalId │
├─────────────────────────────────────────────────────┤
│  2. Create Workspace                                │
│     └─ Convex: workspaces.create(projectId, ...)    │
├─────────────────────────────────────────────────────┤
│  3. Fetch AI Credentials                            │
│     ├─ Convex: aiCredentials.getByOrg()             │
│     └─ Decrypt with encryptionKey                   │
├─────────────────────────────────────────────────────┤
│  4. Create Daytona Sandbox                          │
│     ├─ new DaytonaSandbox(config)                   │
│     ├─ Set environment variables                    │
│     └─ sandbox.ensureRunning()                      │
├─────────────────────────────────────────────────────┤
│  5. Clone Repository (if repoUrl)                   │
│     └─ sandbox.ensureRepo(repoUrl, directory)       │
├─────────────────────────────────────────────────────┤
│  6. Start OpenCode Server                           │
│     └─ sandbox.ensureOpencodeServer(port, cwd)      │
├─────────────────────────────────────────────────────┤
│  7. Inject Credentials                              │
│     └─ For each: sandbox.injectCredential(...)      │
├─────────────────────────────────────────────────────┤
│  8. Update Workspace                                │
│     └─ Convex: workspaces.updateSandbox(...)        │
└─────────────────────────────────────────────────────┘
         │
         ▼
    Return SandboxInfo
```

### 6.3 Credential Encryption

Credentials are encrypted using AES-256-GCM:

```typescript
// Encryption
encrypt(plaintext, key): Promise<string>
  → Generate random 12-byte IV
  → Encrypt with AES-256-GCM
  → Combine: IV + ciphertext
  → Base64 encode

// Decryption
decrypt(encryptedData, key): Promise<string>
  → Base64 decode
  → Split: IV (12 bytes) + ciphertext
  → Decrypt with AES-256-GCM
  → Return plaintext
```

---

## 7. Convex Integration

### 7.1 Schema

```typescript
// convex/schema.ts

defineSchema({
  projects: {
    organizationId: v.string(),
    name: v.string(),
    repoUrl: v.optional(v.string()),
    branch: v.optional(v.string()),
    externalId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },

  workspaces: {
    projectId: v.id("projects"),
    name: v.string(),
    directory: v.string(),
    sandboxId: v.optional(v.string()),
    sandboxUrl: v.optional(v.string()),
    sandboxStatus: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },

  aiCredentials: {
    organizationId: v.string(),
    provider: v.string(),
    encryptedKey: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },

  chat_sessions: {
    workspaceId: v.id("workspaces"),
    sessionId: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },

  user_backends: {
    userId: v.string(),
    organizationId: v.string(),
    backendUrl: v.string(),
    lastSeen: v.number(),
    createdAt: v.number(),
  },
})
```

### 7.2 Key Queries & Mutations

**Projects:**
- `getById(id)` - Fetch project
- `getByExternalId(externalId)` - Lookup by stable ID
- `listByOrg(organizationId)` - All projects in org
- `create(...)` - Create new project

**Workspaces:**
- `getById(id)` - Fetch workspace
- `getByDirectory(directory)` - Reverse lookup
- `listByProject(projectId)` - Workspaces in project
- `create(...)` - Create workspace
- `updateSandbox(...)` - Update sandbox info

**AI Credentials:**
- `getByOrg(organizationId)` - All credentials
- `set(organizationId, provider, encryptedKey)` - Store credential
- `remove(organizationId, provider)` - Delete credential

---

## 8. Security & Authentication

### 8.1 Clerk JWT Verification

```
Authorization: Bearer <JWT>
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  verifyClerkJwt(token)                              │
├─────────────────────────────────────────────────────┤
│  Production: Verify signature with Clerk public key │
│  Development: Parse without verification            │
├─────────────────────────────────────────────────────┤
│  Extract claims:                                    │
│  - userId                                           │
│  - organizationId (REQUIRED)                        │
│  - organizationRole (admin/member)                  │
└─────────────────────────────────────────────────────┘
```

### 8.2 Ownership Verification (FAIL CLOSED)

All workspace access verifies organization ownership:

```typescript
// Workspace access check
const workspace = await getWorkspace(workspaceId)
const project = await getProject(workspace.projectId)

if (project.organizationId !== user.organizationId) {
  return 403 Forbidden  // FAIL CLOSED
}
```

### 8.3 WebSocket Authentication

WebSocket connections use JWT in query params:

```
ws://gateway/pty/123/connect?token=eyJhbGc...
         │
         ▼
1. Extract token from ?token=
2. Verify JWT signature
3. Extract organizationId
4. Verify workspace ownership
5. Allow/deny upgrade
```

---

## 9. Configuration

### 9.1 Environment Variables

```bash
# Server
PORT=3000
HOST=127.0.0.1
NODE_ENV=development

# Convex
CONVEX_URL=https://your-team.convex.cloud

# Daytona
DAYTONA_API_KEY=sk-...
DAYTONA_API_URL=https://daytona.example.com/api
DAYTONA_TARGET=us
DAYTONA_TIMEOUT_MS=10000
DAYTONA_READ_TIMEOUT_MS=30000
DAYTONA_SNAPSHOT_NAME=claxedo-snapshot

# Security
ENCRYPTION_KEY=your-32-byte-key
CLERK_SECRET_KEY=sk_test_...

# OpenCode
OPENCODE_PORT=4096
OPENCODE_MODELS_URL=https://models.dev

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
PROMETHEUS_ENABLED=true
SENTRY_ENABLED=true
SENTRY_DSN=https://...
```

### 9.2 Startup Sequence

```
1. Initialize Observability
   ├─ initTracing() - OpenTelemetry
   ├─ initSentry() - Error tracking
   └─ collectDefaultMetrics() - Node.js metrics

2. Initialize Orchestrator
   ├─ Create SandboxOrchestrator
   ├─ Connect to Convex
   └─ Prepare Daytona SDK

3. Create HTTP Server
   ├─ Build Hono app
   ├─ Register middleware
   └─ Register routes

4. Create WebSocket Server
   └─ PTY connection handler

5. Start Listening
   └─ http://{HOST}:{PORT}
```

---

## 10. Data Flow Examples

### 10.1 Create Workspace

```
POST /api/workspace/create
{
  "projectName": "my-app",
  "repoUrl": "https://github.com/user/repo"
}
         │
         ▼
┌─ Authentication ─────────────────────────────────┐
│  Verify JWT, extract organizationId              │
└──────────────────────────────────────────────────┘
         │
         ▼
┌─ Orchestration ──────────────────────────────────┐
│  1. Create project in Convex                     │
│  2. Create workspace in Convex                   │
│  3. Fetch & decrypt AI credentials               │
│  4. Create Daytona sandbox                       │
│  5. Clone repository                             │
│  6. Start OpenCode server                        │
│  7. Inject credentials                           │
│  8. Update workspace with sandbox URL            │
└──────────────────────────────────────────────────┘
         │
         ▼
Response: {
  workspaceId, sandboxId, url, directory, status
}
```

### 10.2 Directory Proxy with Auto-Wake

```
POST /agent/list
x-opencode-directory: /workspace/proj-123/main
         │
         ▼
┌─ Resolution ─────────────────────────────────────┐
│  1. Query workspace by directory                 │
│  2. Check sandbox status = "stopped"             │
│  3. Wake sandbox (ensureRunning)                 │
│  4. Get fresh preview URL                        │
└──────────────────────────────────────────────────┘
         │
         ▼
┌─ Proxy ──────────────────────────────────────────┐
│  Forward to: {sandboxUrl}/agent/list             │
└──────────────────────────────────────────────────┘
         │
         ▼
Response from sandbox
```

### 10.3 Credential Storage & Sync

```
PUT /auth/openai
{ "type": "api", "key": "sk-proj-..." }
         │
         ▼
┌─ Interception ───────────────────────────────────┐
│  1. Extract API key from body                    │
│  2. Encrypt with AES-256-GCM                     │
│  3. Store in Convex: aiCredentials.set()         │
└──────────────────────────────────────────────────┘
         │
         ▼
┌─ Sync to Active Sandboxes ───────────────────────┐
│  For each sandbox in organization:               │
│  └─ sandbox.injectCredential("openai", key)      │
└──────────────────────────────────────────────────┘
```

---

## Appendix

### A. Metrics Reference

See [OBSERVABILITY.md](./OBSERVABILITY.md) for complete metrics documentation.

### B. Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request (missing params) |
| 401 | Unauthorized (invalid/missing JWT) |
| 403 | Forbidden (organization mismatch) |
| 404 | Resource not found |
| 500 | Internal server error |
| 502 | Bad gateway (sandbox unreachable) |
| 503 | Service unavailable (sandbox not ready) |

### C. Useful Commands

```bash
# Start server
bun run dev

# Build
bun run build

# Type check
bun run typecheck

# Deploy Convex schema
bunx convex deploy
```
