#!/bin/bash
set -e

echo "🚀 Quick Deploy - Using existing images"
echo "========================================="
echo ""

# Get Docker Hub username
if [ -z "$DOCKER_USER" ]; then
    DOCKER_USER=$(docker info 2>/dev/null | grep Username | awk '{print $2}')
    if [ -z "$DOCKER_USER" ]; then
        echo "❌ Not logged into Docker Hub"
        echo "Run: docker login"
        exit 1
    fi
fi

echo "✅ Docker Hub user: $DOCKER_USER"
echo ""

# Check images exist
echo "Checking local images..."
docker images | grep "opencode-veritly" || {
    echo "❌ No local images found"
    exit 1
}
echo ""

# Tag and push
echo "Step 1: Pushing to Docker Hub..."
docker tag opencode-veritly-relay:latest $DOCKER_USER/veritly-relay:latest
docker tag opencode-veritly-opencode:lean $DOCKER_USER/veritly-opencode:latest
docker tag opencode-veritly-executor-api:latest $DOCKER_USER/veritly-executor-api:latest

echo "  Pushing relay (152MB)..."
docker push $DOCKER_USER/veritly-relay:latest

echo "  Pushing executor-api (242MB)..."
docker push $DOCKER_USER/veritly-executor-api:latest

echo "  Pushing opencode (5.48GB - this will take ~15 min)..."
docker push $DOCKER_USER/veritly-opencode:latest

echo "✅ All images pushed"
echo ""

# Deploy to K8s
echo "Step 2: Deploying to Kubernetes..."
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

kubectl apply -k .
echo ""

# Wait
echo "Step 3: Waiting for pods..."
kubectl rollout status deployment/relay -n veritly --timeout=300s || true
kubectl rollout status deployment/opencode -n veritly --timeout=600s || true
kubectl rollout status deployment/executor-api -n veritly --timeout=300s || true
echo ""

# Status
echo "✅ Deployment status:"
kubectl get pods -n veritly
echo ""

# Get IP
IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
if [ "$IP" != "pending" ] && [ -n "$IP" ]; then
    echo "🌐 Ingress IP: $IP"
    echo ""
    echo "Set DNS:"
    echo "  app.veritly.co.uk    → $IP"
    echo "  relay.veritly.co.uk  → $IP"
    echo ""
    echo "Your app: https://app.veritly.co.uk"
fi
