#!/bin/bash
# Test local build before releasing

echo "🔨 Testing Cerebras Build"
echo "=============================="
echo ""

cd packages/cerebras

echo "Building binaries..."
CEREBRAS_CHANNEL=latest CEREBRAS_VERSION=1.0.0-test bun run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "Built binaries are in: packages/cerebras/dist/"
    ls -lh dist/
else
    echo "❌ Build failed"
    exit 1
fi
