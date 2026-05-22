# Veritly Kubernetes Deployment

Public traffic: **Cloudflare** (DNS + TLS + WAF) → **Cloudflare Tunnel** (`cloudflared` pods in `veritly`) → **nginx Ingress** (`ClusterIP` only — no DigitalOcean Load Balancer) → workloads.

Ingress hostnames (HTTP to nginx; TLS only at Cloudflare):

- **app.veritly.co.uk** — Frontend
- **api.veritly.co.uk** — OpenCode API
- **univer.veritly.co.uk** — Univer compat / universer-api
- **relay.veritly.co.uk** — WebSocket relay (`wss://` at the browser; plain HTTP inside the cluster)

## Architecture

```
                         Internet
                             │
                      [Cloudflare]
                    TLS / DNS / WAF
                             │
              outbound tunnel (no public LB)
                             ▼
                 ┌───────────────────────┐
                 │ cloudflared (2 pods)  │
                 │   namespace: veritly  │
                 └───────────┬───────────┘
                             │ HTTP
                             ▼
                 ┌───────────────────────┐
                 │ nginx Ingress         │
                 │ ClusterIP controller  │
                 └───────────┬───────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  opencode-frontend    opencode-api         relay (1 replica)
        :80                 :3000               :8080
```

Relay is **one replica** for now (HPA and ingress cookie affinity are disabled; re-enable when you add multi-relay + stickiness).

## Relay and Cloudflare

The relay is a long-lived WebSocket with **no application-level keepalive**. Cloudflare may close **idle** WebSockets after roughly 100 seconds of no frames (see [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)). Active agent↔browser traffic resets the idle timer. If the spreadsheet tab is idle for minutes, the socket may drop; the browser tab does not auto-reconnect — refresh the sheet if SDK calls report `browser is not connected`.

**Validation after cutover:** run an SDK op with the sheet open, then leave the sheet idle 3–5 minutes and run another op to see if idle timeout affects you.

## Prerequisites

- `kubectl` configured for your cluster
- `doctl` authenticated with DigitalOcean
- Docker installed
- Cloudflare account with **veritly.co.uk** on Cloudflare DNS
- `CLOUDFLARE_TUNNEL_TOKEN` in `.env.production` (synced to `veritly-secrets`)

## Quick Deploy

```bash
cd /Users/Apple/Documents/Github/opencode-veritly
cp .env.production.example .env.production # first time only
# Set CLOUDFLARE_TUNNEL_TOKEN and other secrets in .env.production
./deploy/k8s/sync-env.sh
./deploy/k8s/deploy-production.sh
```

This will:

1. Configure kubectl for your DOKS cluster
2. Create DO Container Registry (if needed)
3. Build and push Docker images
4. Install NGINX Ingress Controller (if needed), then patch `ingress-nginx-controller` to **ClusterIP** (drops DO Load Balancer)
5. Sync env to ConfigMap / Secret
6. Deploy all services including `cloudflared`
7. Wait for rollouts

## Cloudflare Tunnel (manual, once per environment)

1. **Zero Trust** → Networks → Tunnels → create a tunnel (or reuse). Install **Kubernetes** and copy the **token**.
2. Put the token in `.env.production` as `CLOUDFLARE_TUNNEL_TOKEN=...` and run `./deploy/k8s/sync-env.sh`. **Never commit the real token.** If a token was exposed (e.g. in chat), rotate it in Cloudflare and update the secret.
3. For the tunnel, add **public hostname** routes (all use the same origin; nginx routes by `Host`):

   | Hostname | Service URL (type: HTTP) |
   |----------|--------------------------|
   | `app.veritly.co.uk` | `http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80` |
   | `api.veritly.co.uk` | same |
   | `univer.veritly.co.uk` | same |
   | `relay.veritly.co.uk` | same |

4. **DNS:** In the Cloudflare zone, point `app`, `api`, `univer`, `relay` (or full names) at the tunnel as offered by the dashboard (proxied / tunnel route). Do **not** point them at the old DigitalOcean ingress Load Balancer IP once the tunnel is live.

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

`deploy-production.sh` patches `ingress-nginx-controller` to **ClusterIP** after install (see `patch-ingress-nginx-clusterip.yaml`).

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

## Cost note

Removing the DO **Load Balancer** on `ingress-nginx-controller` saves roughly **$12/month** (2025 DO pricing) plus you avoid a public ingress IP; Cloudflare Tunnel + Free/Pro zone is billed per Cloudflare’s pricing.

## Verification

```bash
# Check pods
kubectl get pods -n veritly

# Check services
kubectl get svc -n veritly

# Check ingress
kubectl get ingress -n veritly

# cloudflared
kubectl get pods -n veritly -l app=cloudflared
kubectl logs -n veritly -l app=cloudflared --tail=50

# Test relay health (via Cloudflare)
curl -sf https://relay.veritly.co.uk/readyz

# Test app
curl -sf https://app.veritly.co.uk/global/readyz
```

## Configuration

Edit `.env.production`, then re-run `./deploy/k8s/sync-env.sh`:

| Key | Default | Description |
|-----|---------|-------------|
| `PUBLIC_HOST` | app.veritly.co.uk | Main app domain |
| `PUBLIC_BASE_URL` | https://app.veritly.co.uk | Full URL |
| `VITE_UNIVER_BACKEND_URL` | https://univer.veritly.co.uk | Univer API |
| `VITE_UNIVER_SDK_WS` | wss://relay.veritly.co.uk/ws | Relay WebSocket |
| `CLOUDFLARE_TUNNEL_TOKEN` | (required) | Tunnel run token; stored in `veritly-secrets` |

## Scaling

```bash
# Relay: currently fixed at 1 replica in manifests; HPA commented out.
# When re-enabling multi-relay, restore HPA + Service sessionAffinity + ingress cookie annotations in 01-relay.yaml / 04-ingress.yaml.
kubectl scale deployment relay --replicas=1 -n veritly

# Note: Opencode stays at 1 replica (SQLite constraint)
```

## Troubleshooting

### Pods stuck in ImagePullBackOff

Images aren't in registry. Run the build/push steps.

### cloudflared CrashLoopBackOff

- Confirm `CLOUDFLARE_TUNNEL_TOKEN` is set and synced: `kubectl get secret veritly-secrets -n veritly -o jsonpath='{.data.CLOUDFLARE_TUNNEL_TOKEN}' | base64 -d` (should be non-empty).
- Confirm tunnel public hostnames match the four domains and point at `http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80`.

### WebSocket not connecting

- Check relay ingress annotations (WebSocket timeouts) in `deploy/k8s/base/04-ingress.yaml`.
- See **Relay and Cloudflare** above for idle timeouts.

### Ingress has no public IP

Expected: `ingress-nginx-controller` should be **ClusterIP** only. External access is via Cloudflare Tunnel, not the DO LB IP.

### Legacy cert-manager / Let’s Encrypt

Ingress no longer uses cert-manager TLS for these hostnames (TLS is at Cloudflare). You can leave cert-manager installed for other uses or remove unused `Certificate` objects if you created them manually.

## Univer + Spaces

1. Provision the private exchange bucket: `infra/do-spaces` (Pulumi). See `infra/do-spaces/README.md`.
2. Create DigitalOcean Spaces keys and set `UNIVER_COMPAT_S3_*` in `.env.production`.
3. `./deploy/k8s/sync-env.sh` then `./deploy/k8s/deploy-production.sh` (builds `univer-compat` image).

`univer-compat` runs in-cluster as **ClusterIP** service `univer-compat:8080`; browsers use `https://univer.veritly.co.uk` via Cloudflare → tunnel → nginx.
