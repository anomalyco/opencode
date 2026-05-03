# E2E Testing with Docker Compose

This directory contains end-to-end tests using Docker Compose for infrastructure.

## Prerequisites

You must have the Docker Compose environment running BEFORE running tests:

```bash
# Start all services (postgres, ollama)
./script/setup-e2e.sh

# Or manually:
docker compose -f docker-compose.e2e.yml up -d

# Pull the model (first time only)
docker compose -f docker-compose.e2e.yml exec ollama ollama pull qwen2.5:0.5b
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Compose Network                       │
│  ┌──────────┐   ┌──────────┐                                    │
│  │ Postgres │   │  Ollama  │                                    │
│  │ :15432   │   │ :11435   │                                    │
│  └──────────┘   └──────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
         │              │
         └──────────────┘
                        │
         ┌──────────────▼──────────────┐
         │      Test Runner            │
         │  (Playwright + OpenCode)    │
         └─────────────────────────────┘
```

- **Postgres**: Database for OpenCode server
- **Ollama**: Local AI model (qwen2.5:0.5b - tiny 0.5B model)

## Running Tests

```bash
# 1. Start infrastructure (if not already running)
./script/setup-e2e.sh

# 2. Run all e2e tests
bun run test:e2e:local

# 3. Run specific test
bun run test:e2e:local -- sidebar-session-links.spec.ts
```

## Fail Fast Philosophy

The test runner does NOT try to start containers. It checks if services are available and **fails immediately** if they're not:

```
[E2E] ✗ Required services are not available:
  - ollama: Connection refused
[E2E] Run: ./script/setup-e2e.sh
```

This makes debugging easier - infrastructure problems are infrastructure problems, not test problems.

## Configuration

The test runner creates a temporary config file pointing to the Compose services (see `packages/app/script/e2e-local.ts`).

## Troubleshooting

### Services not available

```bash
# Check what's running
docker compose -f docker-compose.e2e.yml ps

# Restart services
docker compose -f docker-compose.e2e.yml restart

# View logs
docker compose -f docker-compose.e2e.yml logs ollama
```

### Model not found

```bash
# Check if model is in Ollama (host port 11435 maps to container 11434)
curl http://localhost:11435/api/tags

# Pull it manually
docker compose -f docker-compose.e2e.yml exec ollama ollama pull qwen2.5:0.5b
```

### Database issues

```bash
# Reset database
docker compose -f docker-compose.e2e.yml down -v postgres
docker compose -f docker-compose.e2e.yml up -d postgres
```

## Cleanup

```bash
# Stop all services
docker compose -f docker-compose.e2e.yml down

# Stop and remove volumes (data)
docker compose -f docker-compose.e2e.yml down -v
```
