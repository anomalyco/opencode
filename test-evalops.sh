#!/bin/bash
# Test script for EvalOps integration

echo "🧪 Testing EvalOps Integration for OpenCode"
echo "==========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun is not installed. Please install Bun first.${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Installing dependencies...${NC}"
bun install

echo -e "${YELLOW}🔍 Running type checking...${NC}"
if bun run typecheck; then
    echo -e "${GREEN}✅ Type checking passed${NC}"
else
    echo -e "${RED}❌ Type checking failed${NC}"
    exit 1
fi

echo -e "${YELLOW}🧪 Running EvalOps tests...${NC}"
if bun test src/tool/evalops.test.ts; then
    echo -e "${GREEN}✅ EvalOps tests passed${NC}"
else
    echo -e "${RED}❌ EvalOps tests failed${NC}"
    exit 1
fi

echo -e "${YELLOW}🔧 Testing evaluation suite...${NC}"
cd .opencode/evaluations
if bun run code-quality.js > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Evaluation suite runs successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Evaluation suite had issues (this is expected without a full project)${NC}"
fi
cd ../..

echo -e "${YELLOW}📝 Creating test configuration...${NC}"
cat > test.opencode.json << EOF
{
  "evalops": {
    "enabled": true,
    "defaultSuite": "code-quality",
    "autoRun": false,
    "telemetry": false
  }
}
EOF
echo -e "${GREEN}✅ Test configuration created${NC}"

echo -e "${YELLOW}🚀 Starting OpenCode server for testing...${NC}"
echo -e "${YELLOW}   Run 'bun run dev' to start the server with EvalOps${NC}"
echo -e "${YELLOW}   Then test the endpoints:${NC}"
echo ""
echo "   # Get EvalOps config"
echo "   curl http://localhost:3000/evalops/config"
echo ""
echo "   # Run evaluation (replace session-xxx with actual session ID)"
echo "   curl -X POST http://localhost:3000/evalops/run \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"sessionID\": \"session-xxx\", \"suite\": \"code-quality\"}'"
echo ""

echo -e "${GREEN}✅ EvalOps integration test setup complete!${NC}"