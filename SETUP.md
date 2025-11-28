# CI/CD Setup for Cerebras

## What's Already Done

All code has been updated to use "Cerebras" branding:

- ✅ Install script uses `cerebras` binary
- ✅ Publish scripts updated
- ✅ GitHub Actions workflows configured
- ✅ Package names changed to `cerebras-ai`

## Required: GitHub Secrets

You need to add these secrets to your repository for CI/CD to work:

### 1. NPM_TOKEN

```bash
# Login to npm
npm login

# Create a token
npm token create --type=automation

# Add the token to GitHub:
# Go to: Settings → Secrets and variables → Actions → New repository secret
# Name: NPM_TOKEN
# Value: [paste the token from above]
```

### 2. SST_GITHUB_TOKEN

```bash
# Create a Personal Access Token:
# Go to: https://github.com/settings/tokens/new
# Note: "Cerebras CI"
# Scopes: Check 'repo' and 'write:packages'
# Generate token

# Add to GitHub:
# Settings → Secrets and variables → Actions → New repository secret
# Name: SST_GITHUB_TOKEN
# Value: [paste the token]
```

## How to Publish

### Automatic Snapshots (Dev Builds)

Every push to `dev` branch automatically publishes a snapshot:

```bash
git push origin dev
```

Check progress at: Actions tab in GitHub

### Manual Releases (Production)

1. Go to: Actions → publish → Run workflow
2. Select version bump: `patch`, `minor`, or `major`
3. Click "Run workflow"

This will:

- Build binaries for all platforms
- Publish to npm as `cerebras-ai`
- Create GitHub release with downloadable binaries
- Build and push Docker image to ghcr.io

## Installation for Users

Once published, users install with:

```bash
# Recommended
curl -fsSL https://raw.githubusercontent.com/arihantchoudhary/opencode/dev/install | bash

# Or via npm
npm install -g cerebras-ai
```

## Optional: Homebrew Support

If you want Homebrew support, the publish script tries to push to `arihantchoudhary/homebrew-tap`.

You can either:

1. Create that repository, or
2. Comment out the Homebrew section in `packages/cerebras/script/publish.ts` (lines 242-247)

## Optional: AUR Support (Arch Linux)

The publish script tries to publish to AUR. You can either:

1. Set up AUR packages and add `AUR_KEY` secret, or
2. Comment out the AUR section in `packages/cerebras/script/publish.ts` (lines 170-189)

## Testing Locally

Build locally before publishing:

```bash
cd packages/cerebras
bun run build
```

Test the install script:

```bash
bash ./install
```

## Troubleshooting

**Build fails:** Check the Actions logs for specific errors

**npm publish fails:**

- Verify NPM_TOKEN secret is added
- Make sure you're logged into npm with publish permissions

**GitHub release fails:**

- Verify SST_GITHUB_TOKEN secret is added
- Check token has correct permissions

**Install script 404:**

- Wait a few minutes after release for assets to be available
- Check that GitHub release was created successfully

## That's It!

Everything is configured and ready. Just:

1. Add the 2 required secrets (NPM_TOKEN, SST_GITHUB_TOKEN)
2. Run the publish workflow
3. Users can install via the install script or npm
