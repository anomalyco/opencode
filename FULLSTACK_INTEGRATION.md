# Full Stack Integration Tests

## Overview
Comprehensive integration tests that spin up the entire stack:
- **Postgres container** with migrations applied
- **OpenCode server container** (built from source)
- **Client SDK** for type-safe API interactions

## Components Created

### 1. API Client SDK (`packages/opencode/src/client/sdk.ts`)
Type-safe client for the OpenCode API:
```typescript
const client = OpenCode.create({ 
  baseUrl: "http://localhost:4096",
  tenantUserId: "test_user" // Optional, for test auth
})

// Projects
const project = await client.createProject({ name: "My Project" })
const projects = await client.listProjects()

// Sessions
const session = await client.createSession({ 
  projectId: project.id,
  title: "My Session"
})

// Messages
const message = await client.sendMessage({
  sessionId: session.id,
  content: "Hello Big Pickle!"
})
```

### 2. Full Stack Testcontainer (`packages/opencode/test/fixture/fullstack-testcontainer.ts`)
Spawns complete environment:
- Postgres 15 with `veritly` database
- Runs all migrations automatically
- OpenCode server on port 4096
- Connected via Docker network

Usage:
```typescript
await withFullStack(async ({ client, baseUrl, dbUrl }) => {
  // Test the full stack
})
```

### 3. Integration Tests (`packages/opencode/test/integration/fullstack.test.ts`)
14 comprehensive tests:
- Health checks
- Project CRUD (create, list, get)
- Session CRUD with forking support
- Message sending and listing
- Session isolation
- Full workflow: project → session → messages
- Big Pickle greeting test

## Running the Tests

```bash
cd packages/opencode

# Run just the fullstack tests (takes ~3-5 min for first build)
bun test test/integration/fullstack.test.ts --timeout 300000

# Run all tests
bun test
```

## Test Timeout
Tests use 5-minute timeout due to:
1. Docker image building (if needed)
2. Container startup
3. Database migrations
4. Server initialization

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Runner (Bun)                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐  │
│  │        Full Stack Testcontainer                      │  │
│  │                                                      │  │
│  │  ┌──────────────┐      ┌─────────────────────────┐  │  │
│  │  │   Postgres   │      │    OpenCode Server      │  │  │
│  │  │   :5432      │◄────►│    :4096               │  │  │
│  │  │   (migrated) │      │    (migrations run)     │  │  │
│  │  └──────────────┘      └─────────────────────────┘  │  │
│  │           ▲                       ▲                  │  │
│  └───────────┼───────────────────────┼──────────────────┘  │
│              │                       │                      │
│              └───────────────────────┘                      │
│                    Client SDK Calls                          │
└─────────────────────────────────────────────────────────────┘
```

## Files Created

### Core SDK
- `packages/opencode/src/client/sdk.ts` - Type-safe API client

### Test Infrastructure  
- `packages/opencode/src/server/start.ts` - Server start script with migrations
- `packages/opencode/test/fixture/fullstack-testcontainer.ts` - Full stack fixture

### Tests
- `packages/opencode/test/integration/fullstack.test.ts` - Integration tests

## Key Features

1. **Uses real database** - Postgres container with actual migrations
2. **Uses real server** - Full HTTP server running in container
3. **Uses client SDK** - Same primitives frontend would use
4. **Isolated** - Each test run gets fresh containers
5. **Validates implementation** - Tests actual API behavior

## Big Pickle Test
Special test that sends a greeting:
```typescript
await client.sendMessage({
  sessionId: session.id,
  content: "Hi Big Pickle! This is an automated integration test saying hello!"
})
```
