#!/bin/bash
# Check the status of the latest release

echo "🚀 Checking Cerebras Release Status"
echo "========================================"
echo ""

echo "📋 Latest Workflow Runs:"
gh run list --limit 3
echo ""

echo "📦 Latest GitHub Releases:"
gh release list --limit 3
echo ""

echo "🔗 Quick Links:"
echo "  Actions: https://github.com/arihantchoudhary/opencode/actions"
echo "  Releases: https://github.com/arihantchoudhary/opencode/releases"
echo ""

echo "To watch a specific run:"
echo "  gh run list"
echo "  gh run watch <run-id>"
