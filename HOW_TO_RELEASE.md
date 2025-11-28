# How to Release Cerebras to Production

## Prerequisites (One-Time Setup)

### 1. Add npm Token

```bash
# Login to npm (create account at npmjs.com if needed)
npm login

# Create an automation token
npm token create --type=automation
```

Copy the token, then:

1. Go to your repo: https://github.com/arihantchoudhary/opencode/settings/secrets/actions
2. Click "New repository secret"
3. Name: `NPM_TOKEN`
4. Value: paste your token
5. Click "Add secret"

### 2. Add GitHub Token

1. Go to: https://github.com/settings/tokens/new
2. Note: `Cerebras CI`
3. Check these boxes:
   - ✅ repo (all repo permissions)
   - ✅ write:packages
4. Click "Generate token"
5. Copy the token

Then:

1. Go to: https://github.com/arihantchoudhary/opencode/settings/secrets/actions
2. Click "New repository secret"
3. Name: `SST_GITHUB_TOKEN`
4. Value: paste your token
5. Click "Add secret"

**That's it for setup!** You only need to do this once.

---

## How to Push to Production

### Option 1: Via GitHub Website (Easiest)

1. Go to: https://github.com/arihantchoudhary/opencode/actions/workflows/publish.yml
2. Click the "Run workflow" button (on the right)
3. Select branch: `dev`
4. Select bump type:
   - `patch` - for bug fixes (1.0.0 → 1.0.1)
   - `minor` - for new features (1.0.0 → 1.1.0)
   - `major` - for breaking changes (1.0.0 → 2.0.0)
5. Click "Run workflow"

### Option 2: Via Command Line

```bash
# Make sure you have GitHub CLI installed
gh workflow run publish.yml -f bump=patch

# Or for minor/major versions
gh workflow run publish.yml -f bump=minor
gh workflow run publish.yml -f bump=major
```

---

## What Happens During Release

The workflow will automatically:

1. ✅ Build binaries for all platforms:
   - Linux (x64, arm64, musl variants)
   - macOS (x64, arm64)
   - Windows (x64)

2. ✅ Publish to npm as `cerebras-ai`

3. ✅ Create GitHub Release with downloadable binaries

4. ✅ Build and push Docker image to ghcr.io

5. ✅ Tag the release in git

---

## After Release

Users can install with:

```bash
# Shell install script
curl -fsSL https://raw.githubusercontent.com/arihantchoudhary/opencode/dev/install | bash

# npm
npm install -g cerebras-ai

# Docker
docker pull ghcr.io/arihantchoudhary/opencode:latest
```

---

## Checking Release Status

### Monitor the workflow:

https://github.com/arihantchoudhary/opencode/actions

### See published releases:

https://github.com/arihantchoudhary/opencode/releases

### Check npm package:

https://www.npmjs.com/package/cerebras-ai

### Check Docker image:

https://github.com/arihantchoudhary/opencode/pkgs/container/opencode

---

## Development Snapshots (Automatic)

Every push to `dev` branch automatically creates a development snapshot:

```bash
git push origin dev
```

These are published with snapshot version numbers like `0.0.0-dev-202511270830`

---

## Troubleshooting

**Build fails:**

- Check the Actions tab for error logs
- Make sure both secrets (NPM_TOKEN, SST_GITHUB_TOKEN) are added

**npm publish fails:**

- Verify you added NPM_TOKEN secret
- Check you have publish permissions on npm

**GitHub release fails:**

- Verify you added SST_GITHUB_TOKEN secret
- Make sure token has `repo` and `write:packages` permissions

**Can't find the workflow:**

- Make sure you pushed the updated `.github/workflows/publish.yml` to GitHub

---

## That's It!

Your release process is:

1. Make your changes
2. Push to `dev` (creates snapshot)
3. Test the snapshot
4. Run the publish workflow (creates release)
5. Users can install!
