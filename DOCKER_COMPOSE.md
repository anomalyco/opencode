# Docker Compose Files Explained

## docker-compose.dev.yml

**Purpose**: Development environment with everything including external Univer network

- **Postgres**: Database for local development
- **Relay**: WebSocket relay for Univer SDK (port 18766)
- **Executor**: NEW container-based executor with Python + Univer SDK (port 7777)
- **Opencode-API**: Backend API (port 8000)
- **Network**: Uses external `univer-prod` network to connect to existing Univer service

## docker-compose.separated.yml

**Purpose**: Separated frontend/backend for testing production-like setup

- **Postgres**: Same database
- **Opencode-API**: Backend (port 8001)
- **Opencode-Frontend**: Separate frontend container (port 8000)
- **Relay**: Same relay (port 18766)
- **Executor**: Same executor (port 7777)
- **Volumes**: Includes `opencode-data` for persistence testing

## Key Differences

| Feature  | docker-compose.dev.yml         | docker-compose.separated.yml |
| -------- | ------------------------------ | ---------------------------- |
| Frontend | Built into API                 | Separate container           |
| Ports    | API: 8000, Frontend: N/A       | API: 8001, Frontend: 8000    |
| Use Case | Local dev with external Univer | Testing separated services   |
| Networks | External `univer-prod`         | Default internal network     |

## Kubernetes Deployment

Uses the images built from these Dockerfiles:

- `Dockerfile.executor` → `registry.digitalocean.com/veritly-registry/executor:latest`
- `deploy/relay/Dockerfile` → `registry.digitalocean.com/veritly-registry/relay:latest`
- `Dockerfile.api` → `registry.digitalocean.com/veritly-registry/opencode-api:latest`
- `Dockerfile.frontend` → `registry.digitalocean.com/veritly-registry/opencode-frontend:latest`

## Deploy to Production

```bash
# 1. Configure .env.production
cp .env.production.example .env.production
# Edit .env.production with your values

# 2. Run the deployment script
./deploy/k8s/deploy-production.sh
```

This will:

1. Clean up old images from DO registry
2. Build all 4 images (relay, executor, api, frontend)
3. Push to DigitalOcean Container Registry
4. Deploy to Kubernetes cluster
5. Wait for rollout

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Ingress    │  │   Ingress    │  │   Ingress        │  │
│  │app.veritly   │  │relay.veritly │  │univer.veritly    │  │
│  │.co.uk        │  │.co.uk        │  │.co.uk (external) │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│  ┌──────▼───────┐  ┌──────▼───────┐                        │
│  │  Opencode    │  │    Relay     │                        │
│  │  Frontend    │  │   (2+ pods)  │                        │
│  │   (Nginx)    │  │              │                        │
│  └──────┬───────┘  └──────┬───────┘                        │
│         │                 │                                  │
│  ┌──────▼───────┐         │                                  │
│  │  Opencode    │◄────────┘                                  │
│  │    API       │                                            │
│  │   (Bun)      │                                            │
│  └──────┬───────┘                                            │
│         │                                                     │
│  ┌──────▼───────┐                                            │
│  │   Executor   │  Container-based command execution         │
│  │   (2+ pods)  │  with Python + Univer SDK                  │
│  └──────────────┘                                            │
│                                                               │
│  External: Univer service at univer.veritly.co.uk            │
└─────────────────────────────────────────────────────────────┘
```

## Executor Features

The new executor (in `Dockerfile.executor`):

- Runs commands in isolated sessions
- Has Python 3.10 + pip pre-installed
- Has Univer SDK pre-installed
- Connects to relay at `ws://relay:8080/ws`
- Each session gets its own workspace directory
- Auto-cleans up after 5 minutes of inactivity

## Testing Executor Locally

```bash
# Start services
docker-compose -f docker-compose.dev.yml up -d

# Test executor directly
curl -X POST http://localhost:7777/v1/sessions/test/exec \
  -H "Content-Type: application/json" \
  -d '{"command": "python3 -c \"from veritly_univer_sdk import UniverSDK; print(\\\"SDK OK!\\\")\"", "timeout": 30000}'
```
