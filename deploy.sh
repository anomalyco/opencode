#!/bin/bash
set -e

echo "🚀 Deploying Veritly to K8s (using existing images)"
echo "======================================================"
echo ""

# Check for Docker Hub login
if ! docker info | grep -q "Username"; then
    echo "❌ Not logged into Docker Hub"
    echo "Run: docker login"
    exit 1
fi

DOCKER_USER=$(docker info 2>/dev/null | grep Username | awk '{print $2}')
echo "✅ Docker Hub user: $DOCKER_USER"
echo ""

# Tag images
echo "Step 1: Tagging images..."
docker tag opencode-veritly-relay:latest $DOCKER_USER/veritly-relay:latest
docker tag opencode-veritly-opencode:latest $DOCKER_USER/veritly-opencode:latest
docker tag opencode-veritly-executor-api:latest $DOCKER_USER/veritly-executor-api:latest
echo "✅ Tagged"
echo ""

# Push images
echo "Step 2: Pushing images to Docker Hub..."
echo "  (relay - 152MB, should be quick)..."
docker push $DOCKER_USER/veritly-relay:latest

echo "  (executor-api - 242MB)..."
docker push $DOCKER_USER/veritly-executor-api:latest

echo "  (opencode - 5.48GB, this will take 10-15 minutes)..."
docker push $DOCKER_USER/veritly-opencode:latest

echo "✅ All images pushed"
echo ""

# Update kustomization
echo "Step 3: Updating K8s manifests..."
cd /Users/Apple/Documents/Github/veritly/vendor/opencode-veritly/deploy/k8s/base

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

images:
  - name: opencode-veritly-relay
    newName: $DOCKER_USER/veritly-relay
    newTag: latest
  - name: opencode-veritly-opencode
    newName: $DOCKER_USER/veritly-opencode
    newTag: latest
  - name: opencode-veritly-executor-api
    newName: $DOCKER_USER/veritly-executor-api
    newTag: latest
EOF

echo "✅ Kustomization updated"
echo ""

# Deploy
echo "Step 4: Deploying to Kubernetes..."
kubectl apply -k .
echo ""

# Wait for rollout
echo "Step 5: Waiting for pods to be ready..."
kubectl rollout status deployment/relay -n veritly --timeout=300s || true
kubectl rollout status deployment/opencode -n veritly --timeout=600s || true
kubectl rollout status deployment/executor-api -n veritly --timeout=300s || true
echo ""

# Show status
echo "✅ Deployment status:"
kubectl get pods -n veritly
echo ""

# Get ingress IP
echo "Getting ingress IP..."
IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")

if [ "$IP" != "pending" ] && [ -n "$IP" ]; then
    echo ""
    echo "🌐 INGRESS IP: $IP"
    echo ""
    echo "Set these DNS A records:"
    echo "  app.veritly.co.uk    → $IP"
    echo "  relay.veritly.co.uk  → $IP"
    echo ""
    echo "Your app will be at:"
    echo "  https://app.veritly.co.uk"
    echo "  wss://relay.veritly.co.uk/ws"
else
    echo "Ingress IP still pending... check with:"
    echo "  kubectl get svc -n ingress-nginx ingress-nginx-controller"
fi
