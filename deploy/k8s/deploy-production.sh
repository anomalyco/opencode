#!/bin/bash
set -e

echo "🚀 Veritly Kubernetes Deployment"
echo "================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="registry.digitalocean.com/veritly"
CLUSTER_ID="602c73dd-37fe-4c00-a23e-1aa027878fa2"

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
    doctl registry create veritly || echo "Registry might already exist"
fi
echo -e "${GREEN}✅ Registry ready${NC}"
echo ""

echo "Step 4: Logging into registry..."
doctl registry login
echo -e "${GREEN}✅ Logged in${NC}"
echo ""

echo "Step 5: Building images..."
cd /Users/Apple/Documents/Github/veritly/vendor/opencode-veritly

docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml build relay opencode executor-api
echo -e "${GREEN}✅ Images built${NC}"
echo ""

echo "Step 6: Tagging and pushing images..."
docker tag opencode-veritly-relay:latest $REGISTRY/relay:latest
docker tag opencode-veritly-opencode:latest $REGISTRY/opencode:latest
docker tag opencode-veritly-executor-api:latest $REGISTRY/executor-api:latest

docker push $REGISTRY/relay:latest
docker push $REGISTRY/opencode:latest
docker push $REGISTRY/executor-api:latest
echo -e "${GREEN}✅ Images pushed${NC}"
echo ""

echo "Step 7: Installing NGINX Ingress Controller..."
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

echo "Step 8: Updating kustomization with registry..."
cat > deploy/k8s/base/kustomization.yaml << EOF
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
echo -e "${GREEN}✅ Kustomization updated${NC}"
echo ""

echo "Step 9: Updating secrets..."
read -sp "Enter OpenCode server password: " PASSWORD
echo ""
kubectl create secret generic veritly-secrets \
  --from-literal=OPENCODE_SERVER_PASSWORD="$PASSWORD" \
  --namespace veritly \
  --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✅ Secrets updated${NC}"
echo ""

echo "Step 10: Deploying to Kubernetes..."
kubectl apply -k deploy/k8s/base/
echo ""

echo "Step 11: Waiting for rollout..."
kubectl rollout status deployment/relay -n veritly --timeout=300s || true
kubectl rollout status deployment/opencode -n veritly --timeout=300s || true
kubectl rollout status deployment/executor-api -n veritly --timeout=300s || true
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
