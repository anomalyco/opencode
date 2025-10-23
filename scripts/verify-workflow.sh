#!/bin/bash
# Verification script for autonomous workflow system

set -e

echo "=================================================="
echo "Autonomous Workflow System - Verification"
echo "=================================================="
echo ""

# Change to project root
cd "$(dirname "$0")/.."

echo "1. Running TypeScript type check..."
echo "---------------------------------------------------"
cd packages/opencode
bun run typecheck
echo "✓ Type check passed"
echo ""

echo "2. Building project..."
echo "---------------------------------------------------"
bun run build
echo "✓ Build completed"
echo ""

echo "3. Testing workflow command..."
echo "---------------------------------------------------"
./bin/opencode workflow --help
echo "✓ Workflow command registered"
echo ""

echo "4. Running syntax verification..."
echo "---------------------------------------------------"
# Check that all workflow files can be parsed
for file in src/workflow/*.ts; do
  echo "Checking $file..."
  bun build "$file" --target=node --format=esm > /dev/null 2>&1
done
echo "✓ All workflow files have valid syntax"
echo ""

echo "=================================================="
echo "✓ All verification checks passed!"
echo "=================================================="
echo ""
echo "You can now test the workflow system:"
echo "  ./bin/opencode workflow create --prd \"Build JWT authentication\""
echo ""
