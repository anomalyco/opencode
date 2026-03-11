#!/bin/bash
# Test script for session.start hook

echo "=============================================="
echo "Testing session.start Hook"
echo "=============================================="

# Check if bun is available
if ! command -v bun &> /dev/null; then
    echo "❌ Bun not found. Please install Bun first:"
    echo "   curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Not in opencode directory"
    echo "   Run: cd ~/opencode-test"
    exit 1
fi

echo "✅ Bun found"
echo "✅ In opencode directory"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    bun install
fi

echo ""
echo "=============================================="
echo "To test the session.start hook:"
echo "=============================================="
echo ""
echo "1. Run: bun run dev"
echo "2. OpenCode will start"
echo "3. Start a NEW session (not continue)"
echo "4. You'll see in the logs:"
echo "   🎯 session.start hook FIRED!"
echo "   ✅ Context injected into system prompt"
echo ""
echo "Or run with a specific project:"
echo "   bun run dev /path/to/your/project"
echo ""
echo "=============================================="
