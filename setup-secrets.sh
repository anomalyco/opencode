#!/bin/bash
# Setup script for Cerebras CI/CD

echo "🚀 Cerebras CI/CD Setup"
echo "============================"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed"
    echo "Install it with: brew install gh"
    exit 1
fi

# Check if logged in to gh
if ! gh auth status &> /dev/null; then
    echo "📝 Please login to GitHub CLI first:"
    gh auth login
fi

echo "Setting up GitHub secrets..."
echo ""

# NPM Token
echo "1️⃣  NPM_TOKEN Setup"
echo "-------------------"
if gh secret list | grep -q NPM_TOKEN; then
    echo "✅ NPM_TOKEN already exists"
else
    echo "Please create an npm token:"
    echo "  1. Run: npm login"
    echo "  2. Run: npm token create --type=automation"
    echo "  3. Copy the token"
    echo ""
    read -p "Enter your NPM_TOKEN: " npm_token
    if [ -n "$npm_token" ]; then
        gh secret set NPM_TOKEN --body "$npm_token"
        echo "✅ NPM_TOKEN added successfully"
    else
        echo "⚠️  Skipped NPM_TOKEN"
    fi
fi
echo ""

# GitHub Token
echo "2️⃣  SST_GITHUB_TOKEN Setup"
echo "-------------------------"
if gh secret list | grep -q SST_GITHUB_TOKEN; then
    echo "✅ SST_GITHUB_TOKEN already exists"
else
    echo "Creating a GitHub token for you..."
    echo "This token will have 'repo' and 'write:packages' permissions"
    echo ""

    # Try to create a token via gh CLI
    token=$(gh auth token 2>/dev/null)
    if [ -n "$token" ]; then
        echo "Using your current GitHub CLI token..."
        gh secret set SST_GITHUB_TOKEN --body "$token"
        echo "✅ SST_GITHUB_TOKEN added successfully"
    else
        echo "Please create a GitHub token manually:"
        echo "  1. Go to: https://github.com/settings/tokens/new"
        echo "  2. Note: 'Cerebras CI'"
        echo "  3. Check: repo, write:packages"
        echo "  4. Click 'Generate token'"
        echo ""
        read -p "Enter your GitHub token: " gh_token
        if [ -n "$gh_token" ]; then
            gh secret set SST_GITHUB_TOKEN --body "$gh_token"
            echo "✅ SST_GITHUB_TOKEN added successfully"
        else
            echo "⚠️  Skipped SST_GITHUB_TOKEN"
        fi
    fi
fi
echo ""

echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Go to: https://github.com/arihantchoudhary/opencode/actions/workflows/publish.yml"
echo "2. Click 'Run workflow'"
echo "3. Select bump: 'patch'"
echo "4. Click 'Run workflow'"
echo ""
echo "Or run: gh workflow run publish.yml -f bump=patch"
