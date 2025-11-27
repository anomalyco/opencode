#!/bin/bash
# Add npm token to GitHub secrets

echo "🔑 Add NPM Token to GitHub"
echo "==========================="
echo ""
echo "Paste your npm token (starts with npm_...):"
read -s npm_token

if [ -z "$npm_token" ]; then
    echo "❌ No token provided"
    exit 1
fi

echo ""
echo "Adding token to GitHub secrets..."
echo "$npm_token" | gh secret set NPM_TOKEN

if [ $? -eq 0 ]; then
    echo "✅ NPM_TOKEN added successfully!"
    echo ""
    echo "Now re-running the publish workflow to include npm..."
    gh workflow run publish.yml -f bump=patch
    echo "✅ Workflow triggered!"
    echo ""
    echo "Check status: ./check-release.sh"
else
    echo "❌ Failed to add token"
    exit 1
fi
