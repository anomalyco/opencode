# Veritly Kubernetes Deployment

Two separate ingresses for clean separation of concerns:
- **app.veritly.co.uk** - OpenCode API + Frontend (HTTP)
- **relay.veritly.co.uk** - WebSocket Relay (WSS) with sticky sessions

## Architecture

```
                    Internet
                       │
           ┌───────────┴───────────┐
           │                       │
     [app.veritly.co.uk]    [relay.veritly.co.uk]
     (HTTP/HTTPS)              (WSS - WebSocket)
           │                       │
           ▼                       ▼
    ┌─────────────┐         ┌─────────────┐
    │   Opencode  │         │    Relay    │
    │    :3000    │         │    :8080    │
    │  (1 replica)│         │  (2+ replicas)│
    └─────────────┘         └─────────────┘
                                     │
                              ┌──────┴──────┐
                              │Python SDK   │
                              │Local dev     │
                              └─────────────┘

External: univer.veritly.co.uk (already deployed)
```

## Why Two Ingresses?

1. **WebSocket needs special config**: Longer timeouts, sticky sessions, connection upgrades
2. **Different scaling patterns**: Relay needs 2+ replicas with affinity, Opencode is 1 replica (SQLite)
3. **Clean separation**: Browser connects directly to relay domain
4. **Independent SSL/TLS**: Each can have its own cert config

## Prerequisites

- `kubectl` configured for your cluster
- `doctl` authenticated with DigitalOcean
- Docker installed

## Quick Deploy

```bash
cd /Users/Apple/Documents/Github/opencode-veritly
cp .env.production.example .env.production # first time only
./deploy/k8s/sync-env.sh
./deploy/k8s/deploy-production.sh
```

This will:
1. Configure kubectl for your DOKS cluster
2. Create DO Container Registry (if needed)
3. Build and push Docker images
4. Install NGINX Ingress Controller (if needed)
5. Deploy all services
6. Wait for rollout

## Database migrations (Drizzle)

Migrations live in `packages/opencode/migration/` and are **baked into the `opencode-api` image** at build time. The cluster does not read the repo from disk; it only runs what is inside the image you pushed.

**After the API (and any migration changes) are deployed and workloads are up**, run a one-shot Job that uses the **same** `opencode-api` image and your `DATABASE_URL` from `veritly-secrets`:

```bash
kubectl create -f deploy/k8s/opencode-migrate-job.yaml
```

- Use `kubectl create` (not `apply`) because the Job uses `generateName`.
- Logs: `kubectl logs -n veritly -l app=opencode-migrate --tail=100`
- The script records applied migration folder names in Postgres table `__drizzle_migrations`.

**Order of operations that avoids surprises:** build and push `opencode-api` with the new migration SQL → apply Kubernetes manifests / rollout → **then** run the migration Job. If you run the Job before pushing an image that contains the new `migration/` folders, those migrations will not run.

**Future automation:** wire this into CI (e.g. after `opencode-api` image push) or a post-deploy script; same Job manifest is the building block.

## Manual Steps

### Executor in-cluster vs laptop port-forward

**Production:** OpenCode / API uses the executor **Service DNS inside the cluster** (same namespace / ClusterIP). No tunnel — see `packages/executor/README.md` “Mode 1”.

**Local laptop (Mac):** run the executor locally with QEMU (`packages/executor/README.md` “Mode 2”), or use **port-forward** to `executor-dev` in-cluster:

```bash
./script/executor-dev-port-forward.sh
# or: bun run --cwd packages/opencode executor-dev:k8s-tunnel

export VERITLY_EXECUTOR_URL=http://127.0.0.1:7777
```

Image build/push is unchanged — port-forward is only to reach an already-running cluster executor from localhost.

### 1. Configure kubectl
```bash
doctl kubernetes cluster kubeconfig save 602c73dd-37fe-4c00-a23e-1aa027878fa2
```

### 2. Install NGINX Ingress Controller
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.4/deploy/static/provider/do/deploy.yaml
```

### 3. Build and Push Images
```bash
# Set up registry
doctl registry create veritly  # if not exists
doctl registry login

# Sync Kubernetes config + secrets from .env.production
./deploy/k8s/sync-env.sh

# Tag
docker tag opencode-veritly-relay:latest registry.digitalocean.com/veritly/relay:latest
docker tag opencode-veritly-opencode:latest registry.digitalocean.com/veritly/opencode:latest
docker tag opencode-veritly-executor-api:latest registry.digitalocean.com/veritly/executor-api:latest

# Push
docker push registry.digitalocean.com/veritly/relay:latest
docker push registry.digitalocean.com/veritly/opencode:latest
docker push registry.digitalocean.com/veritly/executor-api:latest
```

To **drop old image manifests** and keep only `latest` per repository, use `doctl` + JSON (not the default text table) — see `deploy/k8s/clean-registry-nonlatest.sh`. Set `DO_REGISTRY_NAME` if the registry is not `veritly-registry`. Afterward, run `doctl registry garbage-collection start` if DigitalOcean still shows high storage from untagged layer data.

### 4. Update Registry in Kustomization
```bash
# Edit deploy/k8s/base/kustomization.yaml
# Change image newName to your registry
```

### 5. Sync Env
```bash
./deploy/k8s/sync-env.sh
```

### 6. Deploy
```bash
kubectl apply -k deploy/k8s/base/
```

## DNS Configuration

Get the ingress IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

Point both domains to this IP:
- `app.veritly.co.uk` → INGRESS_IP
- `relay.veritly.co.uk` → INGRESS_IP

## Verification

```bash
# Check pods
kubectl get pods -n veritly

# Check services
kubectl get svc -n veritly

# Check ingress
kubectl get ingress -n veritly

# Test relay health
curl https://relay.veritly.co.uk/readyz

# Test app
curl https://app.veritly.co.uk/global/readyz
```

## Configuration

Edit `.env.production`, then re-run `./deploy/k8s/sync-env.sh`:

| Key | Default | Description |
|-----|---------|-------------|
| `PUBLIC_HOST` | app.veritly.co.uk | Main app domain |
| `PUBLIC_BASE_URL` | https://app.veritly.co.uk | Full URL |
| `VITE_UNIVER_BACKEND_URL` | https://univer.veritly.co.uk | Univer API |
| `VITE_UNIVER_SDK_WS` | wss://relay.veritly.co.uk/ws | Relay WebSocket |

## Scaling

```bash
# Scale relay (already has HPA 2-10 replicas)
kubectl scale deployment relay --replicas=5 -n veritly

# Scale executor
kubectl scale deployment executor-api --replicas=3 -n veritly

# Note: Opencode stays at 1 replica (SQLite constraint)
```

## Troubleshooting

### Pods stuck in ImagePullBackOff
Images aren't in registry. Run the build/push steps.

### Ingress has no IP
NGINX ingress controller not installed. Run:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.4/deploy/static/provider/do/deploy.yaml
```

### WebSocket not connecting
Check relay ingress has sticky session annotations:
```bash
kubectl describe ingress veritly-relay -n veritly
```

### SSL cert not working
Install cert-manager:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
```

## External Dependencies

- **Univer**: Already deployed at `univer.veritly.co.uk`
- **USIP**: Part of Univer deployment

These are configured in the ConfigMap and must be accessible from the cluster.
