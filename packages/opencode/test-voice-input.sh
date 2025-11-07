#!/bin/bash

# Test Voice Input Setup Script
# This script helps you test the voice input feature

echo "🎤 OpenCode Voice Input Test"
echo "=============================="
echo ""

# Check if SoX is installed
echo "Checking dependencies..."
if ! command -v sox &> /dev/null; then
    echo "❌ SoX not found!"
    echo ""
    echo "Install SoX:"
    echo "  macOS:   brew install sox"
    echo "  Ubuntu:  sudo apt-get install sox libsox-fmt-all"
    echo ""
    exit 1
fi
echo "✅ SoX installed: $(sox --version | head -1)"
echo ""

# Check LiveKit environment variables
echo "Checking LiveKit configuration..."
if [ -z "$LIVEKIT_URL" ]; then
    echo "⚠️  LIVEKIT_URL not set"
    echo ""
    echo "Set up LiveKit credentials:"
    echo "  export LIVEKIT_URL='wss://your-project.livekit.cloud'"
    echo "  export LIVEKIT_API_KEY='your-api-key'"
    echo "  export LIVEKIT_API_SECRET='your-api-secret'"
    echo ""
    echo "Or use local development server:"
    echo "  docker run --rm -p 7880:7880 \\"
    echo "    -e LIVEKIT_KEYS='devkey: secret' \\"
    echo "    livekit/livekit-server \\"
    echo "    --dev"
    echo ""
    echo "  export LIVEKIT_URL='ws://localhost:7880'"
    echo "  export LIVEKIT_API_KEY='devkey'"
    echo "  export LIVEKIT_API_SECRET='secret'"
    echo ""
    exit 1
fi
echo "✅ LIVEKIT_URL: $LIVEKIT_URL"
echo "✅ LIVEKIT_API_KEY: ${LIVEKIT_API_KEY:0:10}..."
echo "✅ LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET:0:10}..."
echo ""

# Check microphone access
echo "Testing microphone access..."
echo "Recording 2 seconds of audio..."
if sox -d -n trim 0 2 2>&1 | grep -q "sox FAIL"; then
    echo "❌ Microphone access failed!"
    echo "   Check system permissions for microphone access"
    exit 1
fi
echo "✅ Microphone access working!"
echo ""

echo "🎉 All checks passed!"
echo ""
echo "To start OpenCode with voice input:"
echo "  1. Run: bun dev"
echo "  2. Press Ctrl+P (command palette)"
echo "  3. Type: 'Start Voice Input'"
echo "  4. Enter your room name and credentials"
echo "  5. Press Enter to connect"
echo ""
echo "You should see 🎤 room-name in the bottom status bar!"
echo ""
echo "Test in browser first:"
echo "  → https://meet.livekit.io"
echo "  → Enter your server URL and room name"
echo "  → Verify audio works"
echo ""
