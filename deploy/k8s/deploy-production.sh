#!/bin/bash
set -euo pipefail

echo "🚀 Veritly Kubernetes Deployment"
echo "================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="registry.digitalocean.com/veritly-registry"
CLUSTER_ID="602c73dd-37fe-4c00-a23e-1aa027878fa2"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPOS=("relay" "opencode-api" "opencode-frontend")
APPS=("relay" "opencode-api" "opencode-frontend")

clean_repo() {
    local repo="$1"
    while read -r digest tags; do
        if [ -z "${digest:-}" ]; then
            continue
        fi
        case ",${tags:-}," in
            *,latest,*)
                continue
                ;;
        esac
        doctl registry repository delete-manifest "veritly-registry/$repo" "$digest" --force >/dev/null 2>&1 || true
    done < <(doctl registry repository list-manifests "veritly-registry/$repo" --format Digest,Tags --no-header 2>/dev/null || true)
}

echo "Step 1: Checking prerequisites..."
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}❌ kubectl not found. Install: brew install kubectl${NC}"
    exit 1
fi

if ! command -v doctl &> /dev/null; then
    echo -e "${RED}❌ doctl not found. Install: brew install doctl${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ docker not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites met${NC}"
echo ""

echo "Step 2: Configuring kubectl..."
doctl kubernetes cluster kubeconfig save $CLUSTER_ID > /dev/null 2>&1
echo -e "${GREEN}✅ kubectl configured${NC}"
echo ""

echo "Step 3: Checking container registry..."
if ! doctl registry get &> /dev/null; then
    echo -e "${YELLOW}⚠️  Container Registry not found. Creating...${NC}"
    doctl registry create veritly-registry || echo "Registry might already exist"
fi
echo -e "${GREEN}✅ Registry ready${NC}"
echo ""

echo "Step 4: Logging into registry..."
doctl registry login
echo -e "${GREEN}✅ Logged in${NC}"
echo ""

echo "Step 5: Cleaning up old images from registry..."
echo -e "${YELLOW}⚠️  Deleting old images to save space...${NC}"
for repo in "${REPOS[@]}"; do
    clean_repo "$repo"
done
echo -e "${GREEN}✅ Old images cleaned up${NC}"
echo ""

echo "Step 6: Building images for linux/amd64..."
cd "$ROOT"

echo "Building frontend dist..."
bun --env-file=.env.production --cwd packages/app build

# Enable buildx for multi-platform builds
docker buildx create --use --name veritly-builder 2>/dev/null || docker buildx use veritly-builder
docker buildx inspect --bootstrap >/dev/null

# Build relay
echo "Building relay..."
docker buildx build --platform linux/amd64 -f docker/Dockerfile.relay -t $REGISTRY/relay:latest --push .

# Build opencode API
echo "Building opencode-api..."
docker buildx build --platform linux/amd64 -f docker/Dockerfile.api -t $REGISTRY/opencode-api:latest --push .

# Build opencode frontend
echo "Building opencode-frontend..."
docker buildx build --platform linux/amd64 -f docker/Dockerfile.frontend -t $REGISTRY/opencode-frontend:latest --push .

echo -e "${GREEN}✅ Images built${NC}"
echo ""

echo "Step 7: Cleaning registry after push..."
for repo in "${REPOS[@]}"; do
    clean_repo "$repo"
done
echo -e "${GREEN}✅ Images pushed${NC}"
echo ""

echo "Step 8: Installing NGINX Ingress Controller..."
if ! kubectl get pods -n ingress-nginx &> /dev/null; then
    kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.4/deploy/static/provider/do/deploy.yaml
    echo "Waiting for ingress controller..."
    kubectl wait --namespace ingress-nginx \
      --for=condition=ready pod \
      --selector=app.kubernetes.io/component=controller \
      --timeout=120s
fi
echo -e "${GREEN}✅ Ingress controller ready${NC}"
echo ""

echo "Step 9: Syncing env from .env.production..."
"$ROOT/deploy/k8s/sync-env.sh"
echo -e "${GREEN}✅ Env synced${NC}"
echo ""

echo "Step 10: Removing legacy workloads..."
kubectl delete deployment executor-api opencode -n veritly --ignore-not-found >/dev/null 2>&1 || true
kubectl delete service executor-api opencode -n veritly --ignore-not-found >/dev/null 2>&1 || true
echo -e "${GREEN}✅ Legacy workloads removed${NC}"
echo ""

echo "Step 11: Deploying to Kubernetes..."
kubectl apply -k deploy/k8s/base/
echo ""

echo "Step 12: Restarting deployments so :latest is pulled..."
for app in "${APPS[@]}"; do
    kubectl rollout restart deployment/$app -n veritly >/dev/null
done
echo -e "${GREEN}✅ Rollouts restarted${NC}"
echo ""

echo "Step 13: Waiting for rollout..."
for app in "${APPS[@]}"; do
    kubectl rollout status deployment/$app -n veritly --timeout=300s || true
done
echo ""

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Services:"
kubectl get svc -n veritly
echo ""
echo "Pods:"
kubectl get pods -n veritly
echo ""
echo "Ingress:"
kubectl get ingress -n veritly
echo ""

echo "🌐 Your app will be available at:"
echo "   - https://app.veritly.co.uk (main app)"
echo "   - wss://relay.veritly.co.uk/ws (WebSocket relay)"
echo ""
echo "⚠️  Make sure your DNS points to the ingress IP:"
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "   (waiting for IP...)"
echo ""
