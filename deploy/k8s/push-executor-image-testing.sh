#!/usr/bin/env bash
set -euo pipefail

# Build and push the QEMU executor image, then restart a deployment.
#
# Default: tag latest, deployment executor.
# Test Dockerfile on executor-dev only:
#   EXECUTOR_IMAGE_TAG=dev EXECUTOR_DEPLOYMENT=executor-dev ./deploy/k8s/push-executor-image.sh
# VM artifacts must exist first (Linux host with KVM not required for *building* the rootfs):
#   (cd packages/executor && bun run build-vm)
# See packages/executor/README.md

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGISTRY="registry.digitalocean.com/veritly-registry"
NS="${K8S_NAMESPACE:-veritly}"
TAG="${EXECUTOR_IMAGE_TAG:-latest}"
DEPLOY="${EXECUTOR_DEPLOYMENT:-executor}"

if [ ! -s "$ROOT/packages/executor/output/vmlinux" ] || [ ! -s "$ROOT/packages/executor/output/rootfs.ext4" ]; then
  echo "Missing packages/executor/output/vmlinux or rootfs.ext4" >&2
  echo "On a Linux machine (amd64) with sudo, from repo root:" >&2
  echo "  (cd packages/executor && bun run build-vm)" >&2
  exit 1
fi

cd "$ROOT"

if ! command -v docker >/dev/null; then
  echo "docker not found" >&2
  exit 1
fi

doctl registry login

docker buildx create --use --name veritly-builder 2>/dev/null || docker buildx use veritly-builder
docker buildx inspect --bootstrap >/dev/null

echo "Building and pushing executor:$TAG (linux/amd64)..."
docker buildx build --platform linux/amd64 -f docker/Dockerfile.executor -t "$REGISTRY/executor:$TAG" --push .

echo "Restarting deployment/$NS/$DEPLOY..."
kubectl rollout restart "deployment/$DEPLOY" -n "$NS"
kubectl rollout status "deployment/$DEPLOY" -n "$NS" --timeout=300s

echo "Done. Health check — use the executor pod (has curl), not opencode-api:"
echo "  kubectl exec -n $NS deploy/$DEPLOY -- curl -fsS http://127.0.0.1:7777/readyz"
if [ "$DEPLOY" = "executor-dev" ]; then
  echo "Port-forward for local API:"
  echo "  ./script/executor-dev-port-forward.sh"
  echo "  export VERITLY_EXECUTOR_URL=http://127.0.0.1:7777"
fi
