#!/bin/bash
set -e

# Veritly K8s Deploy Script
# Usage: ./deploy.sh [environment]

ENV=${1:-production}
REGISTRY=${REGISTRY:-"registry.digitalocean.com/veritly"}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "🚀 Deploying Veritly to Kubernetes (env: $ENV)"
echo ""

# Check prerequisites
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found"
    exit 1
fi

if ! command -v doctl &> /dev/null; then
    echo "❌ doctl not found. Install with: brew install doctl"
    exit 1
fi

# Authenticate with DO
if ! doctl account get &> /dev/null; then
    echo "🔐 Authenticating with DigitalOcean..."
    doctl auth init
fi

# Configure kubectl
echo "🔧 Configuring kubectl..."
doctl kubernetes cluster kubeconfig save 602c73dd-37fe-4c00-a23e-1aa027878fa2

# Verify cluster
echo "☸️  Verifying cluster connection..."
kubectl cluster-info
kubectl get nodes

# Build images
echo ""
echo "📦 Building images..."
cd "$ROOT"

docker compose --env-file .env.production -f docker-compose.selfhost.yml build relay opencode executor-api

# Tag images
echo ""
echo "🏷️  Tagging images..."
docker tag opencode-veritly-relay:latest $REGISTRY/relay:latest
docker tag opencode-veritly-opencode:latest $REGISTRY/opencode:latest
docker tag opencode-veritly-executor-api:latest $REGISTRY/executor-api:latest

# Push images (requires DO container registry auth)
echo ""
echo "📤 Pushing images to registry..."
docker push $REGISTRY/relay:latest
docker push $REGISTRY/opencode:latest
docker push $REGISTRY/executor-api:latest

# Update image references in kustomization
echo ""
echo "📝 Updating kustomization..."
cd deploy/k8s/base
cat > kustomization.yaml << EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: veritly

resources:
  - 00-namespace.yaml
  - 01-relay.yaml
  - 02-opencode.yaml
  - 03-executor.yaml
  - 04-ingress.yaml

commonLabels:
  app.kubernetes.io/part-of: veritly
  app.kubernetes.io/managed-by: kubectl

images:
  - name: opencode-veritly-relay
    newName: $REGISTRY/relay
    newTag: latest
  - name: opencode-veritly-opencode
    newName: $REGISTRY/opencode
    newTag: latest
  - name: opencode-veritly-executor-api
    newName: $REGISTRY/executor-api
    newTag: latest
EOF

# Deploy
echo ""
echo "🚀 Applying manifests..."
"$ROOT/deploy/k8s/sync-env.sh"
kubectl apply -k .

# Wait for rollout
echo ""
echo "⏳ Waiting for rollout..."
kubectl rollout status deployment/relay -n veritly --timeout=300s
kubectl rollout status deployment/opencode -n veritly --timeout=300s
kubectl rollout status deployment/executor-api -n veritly --timeout=300s

# Show status
echo ""
echo "✅ Deployment complete!"
echo ""
kubectl get pods -n veritly
kubectl get svc -n veritly
kubectl get ingress -n veritly

echo ""
echo "🌐 Access your app at: https://app.veritly.co.uk"
echo "🔗 Relay WebSocket: wss://relay.veritly.co.uk/ws"
