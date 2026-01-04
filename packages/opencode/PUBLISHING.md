# Publishing @geocomply/opencode to GitHub Packages

## Package Configuration

The package is configured to publish to GitHub Packages:

```json
{
  "name": "@geocomply/opencode",
  "version": "1.0.224",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

## Prerequisites

You need a GitHub Personal Access Token (PAT) with `write:packages` scope.

### Create a PAT (if you don't have one)

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - `write:packages` (required)
   - `read:packages` (recommended)
   - `delete:packages` (optional)
4. Generate and copy the token

### Configure npm Authentication

Add to your `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Or set via environment variable:

```bash
export NPM_TOKEN=YOUR_GITHUB_TOKEN
```

## Publishing

### Option 1: Manual Publish

From `packages/opencode` directory:

```bash
# Build first (optional, but recommended)
bun run build

# Publish
npm publish
```

### Option 2: Using Bun

```bash
bun publish
```

### Option 3: CI/CD (GitHub Actions)

Add to `.github/workflows/publish.yml`:

```yaml
- name: Publish to GitHub Packages
  run: |
    cd packages/opencode
    npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Installation

Users can install the package with:

```bash
# Configure registry for @geocomply scope
npm config set @geocomply:registry https://npm.pkg.github.com

# Install
npm install @geocomply/opencode
```

Or in `.npmrc`:

```
@geocomply:registry=https://npm.pkg.github.com
```

## Version Bumping

Before publishing, bump the version:

```bash
# Patch (1.0.224 -> 1.0.225)
npm version patch

# Minor (1.0.224 -> 1.1.0)
npm version minor

# Major (1.0.224 -> 2.0.0)
npm version major
```

## Verification

After publishing, verify at:

```
https://github.com/orgs/GeoComply/packages/npm/package/opencode
```

Or browse all GeoComply packages:

```
https://github.com/orgs/GeoComply/packages
```

## Notes

- Package is scoped to `@geocomply` organization
- Published to GitHub Packages (not public npm)
- Same authentication as oh-my-opencode package
- Version follows semantic versioning
