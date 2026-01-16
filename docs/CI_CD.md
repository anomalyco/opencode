# CI/CD Pipeline Documentation

**Last Updated:** 2026-01-15

This document covers the continuous integration and deployment pipelines for OpenWork.

## Table of Contents

- [Overview](#overview)
- [Workflow Summary](#workflow-summary)
- [Core Workflows](#core-workflows)
- [Release Process](#release-process)
- [Secrets Management](#secrets-management)
- [Troubleshooting](#troubleshooting)

---

## Overview

OpenWork uses **GitHub Actions** for CI/CD with 21 workflows handling:

- Testing and type checking
- Multi-platform desktop builds (macOS, Windows, Linux)
- NPM package publishing
- Docker image publishing
- VS Code extension publishing
- Documentation updates
- Issue triage and management

### Infrastructure

| Component | Provider |
|-----------|----------|
| CI Runners | Blacksmith (faster Ubuntu/Windows) |
| macOS Builds | GitHub-hosted `macos-latest` |
| Container Registry | GitHub Container Registry (ghcr.io) |
| Package Registry | npm |
| Desktop Distribution | GitHub Releases |
| AUR | Arch User Repository |

---

## Workflow Summary

### Development Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `test.yml` | Push to dev, PRs | Type checking and tests |
| `typecheck.yml` | PRs | TypeScript validation |
| `pr-standards.yml` | PRs | PR validation and checks |
| `review.yml` | PRs | Automated code review |

### Release Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `publish.yml` | Push to dev, Manual | Full release pipeline |
| `publish-vscode.yml` | Manual | VS Code extension release |
| `publish-github-action.yml` | Manual | GitHub Action release |

### Maintenance Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `stale-issues.yml` | Scheduled | Close stale issues |
| `duplicate-issues.yml` | Issues | Detect duplicate issues |
| `duplicate-prs.yml` | PRs | Detect duplicate PRs |
| `triage.yml` | Issues | Auto-label and triage |

### Infrastructure Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `deploy.yml` | Push | Deploy services |
| `docs-update.yml` | Push | Update documentation |
| `generate.yml` | Manual | Generate code/assets |
| `stats.yml` | Scheduled | Collect usage statistics |
| `notify-discord.yml` | Releases | Discord notifications |
| `nix-desktop.yml` | Push | Nix package builds |
| `update-nix-hashes.yml` | Manual | Update Nix hashes |
| `sync-zed-extension.yml` | Manual | Sync Zed extension |

---

## Core Workflows

### Test Workflow (`test.yml`)

Runs on every push to `dev` and all pull requests.

```yaml
name: test
on:
  push:
    branches: [dev]
  pull_request:
  workflow_dispatch:

jobs:
  test:
    runs-on: blacksmith-4vcpu-ubuntu-2404
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-bun
      - run: |
          bun turbo typecheck
          bun turbo test
```

**What it does:**
1. Checks out the repository
2. Sets up Bun using the reusable action
3. Runs type checking across all packages
4. Runs all tests

### Publish Workflow (`publish.yml`)

The main release workflow with three stages:

#### Stage 1: `publish`
- Runs on Ubuntu
- Publishes NPM packages
- Creates Git tags
- Uploads CLI artifacts

#### Stage 2: `publish-tauri`
- Builds desktop app for all platforms
- Matrix build configuration:

| Platform | Runner | Target |
|----------|--------|--------|
| macOS Intel | `macos-latest` | `x86_64-apple-darwin` |
| macOS ARM | `macos-latest` | `aarch64-apple-darwin` |
| Windows | `blacksmith-4vcpu-windows-2025` | `x86_64-pc-windows-msvc` |
| Linux x64 | `blacksmith-4vcpu-ubuntu-2404` | `x86_64-unknown-linux-gnu` |
| Linux ARM | `blacksmith-4vcpu-ubuntu-2404-arm` | `aarch64-unknown-linux-gnu` |

- Signs macOS builds with Apple Developer certificate
- Signs Windows builds
- Creates GitHub release artifacts

#### Stage 3: `publish-release`
- Finalizes the release
- Publishes to AUR (Arch User Repository)
- Updates release notes

### PR Standards (`pr-standards.yml`)

Enforces pull request conventions:
- Title format validation
- Required labels
- Branch naming conventions
- Commit message format

---

## Release Process

### Automated Releases (on push to dev)

Every push to `dev` triggers a snapshot release:
1. Version is auto-incremented
2. NPM packages are published with `@snapshot` tag
3. Desktop builds are created as draft releases

### Manual Releases

To create a production release:

1. **Go to Actions** → `publish` workflow
2. **Click "Run workflow"**
3. **Select options:**
   - `bump`: major | minor | patch
   - `version`: (optional) specific version override

```
Example: bump=minor creates 1.2.0 → 1.3.0
```

### Version Bumping

| Bump Type | When to Use | Example |
|-----------|-------------|---------|
| `major` | Breaking changes | 1.x.x → 2.0.0 |
| `minor` | New features | 1.2.x → 1.3.0 |
| `patch` | Bug fixes | 1.2.3 → 1.2.4 |

### Release Artifacts

Each release creates:

| Artifact | Location |
|----------|----------|
| NPM packages | npmjs.com |
| CLI binary | GitHub Release |
| macOS `.dmg` | GitHub Release |
| Windows `.msi` | GitHub Release |
| Linux `.AppImage` | GitHub Release |
| Linux `.deb` | GitHub Release |
| AUR package | aur.archlinux.org |
| Docker image | ghcr.io |

---

## Secrets Management

### Required Secrets

| Secret | Purpose | Required For |
|--------|---------|--------------|
| `GITHUB_TOKEN` | GitHub API access | All workflows |
| `SST_GITHUB_TOKEN` | Extended GitHub access | Releases |
| `NPM_TOKEN` | NPM publishing | NPM packages |
| `OPENCODE_API_KEY` | OpenCode service | Publishing |

### Apple Signing (macOS)

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Code signing cert (base64) |
| `APPLE_CERTIFICATE_PASSWORD` | Cert password |
| `APPLE_API_KEY` | Notarization API key |
| `APPLE_API_KEY_PATH` | API key file content |
| `APPLE_API_ISSUER` | API issuer ID |

### Tauri Signing

| Secret | Purpose |
|--------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Update signing key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password |

### Distribution

| Secret | Purpose |
|--------|---------|
| `AUR_KEY` | Arch User Repository SSH key |

---

## Local Setup for CI Development

### Testing Workflows Locally

Use [act](https://github.com/nektos/act) to run workflows locally:

```bash
# Install act
brew install act

# Run test workflow
act push -W .github/workflows/test.yml

# Run with secrets
act -s GITHUB_TOKEN="$(gh auth token)" push
```

### Reusable Actions

The repository contains reusable actions in `.github/actions/`:

#### `setup-bun`
Sets up Bun with caching:

```yaml
- uses: ./.github/actions/setup-bun
```

### Workflow Development Tips

1. **Use `workflow_dispatch`** for manual testing:
   ```yaml
   on:
     workflow_dispatch:
   ```

2. **Use `act` for local testing** before pushing

3. **Check logs** in GitHub Actions → Select workflow → Select job

4. **Use artifacts** for debugging:
   ```yaml
   - uses: actions/upload-artifact@v4
     with:
       name: debug-logs
       path: ./logs
   ```

---

## Troubleshooting

### Common Issues

#### Build Failures on macOS

**Symptom:** Code signing fails

**Solution:**
- Verify certificate is not expired
- Check `APPLE_CERTIFICATE` secret is valid base64
- Ensure certificate password is correct

#### Build Failures on Linux

**Symptom:** Missing webkit dependencies

**Solution:**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev
```

#### NPM Publish Fails

**Symptom:** 401 Unauthorized

**Solution:**
- Regenerate `NPM_TOKEN`
- Ensure token has publish permissions
- Check package name availability

#### Tauri Build Timeout

**Symptom:** Build exceeds 60 minute limit

**Solution:**
- Check Rust cache is being used
- Verify no unnecessary rebuilds
- Consider splitting build matrix

### Debugging Workflows

1. **Enable debug logging:**
   Add secret `ACTIONS_STEP_DEBUG=true`

2. **SSH into runner:**
   ```yaml
   - uses: mxschmitt/action-tmate@v3
     if: failure()
   ```

3. **Check workflow syntax:**
   ```bash
   # Validate workflow file
   actionlint .github/workflows/my-workflow.yml
   ```

### Re-running Failed Jobs

1. Go to the failed workflow run
2. Click "Re-run failed jobs" or "Re-run all jobs"
3. For flaky tests, the publish workflow has auto-retry:
   ```yaml
   - uses: Wandalen/wretry.action@v3
     with:
       attempt_limit: 3
       attempt_delay: 10000
   ```

---

## Adding New Workflows

### Template

```yaml
name: my-workflow
on:
  push:
    branches: [dev]
  pull_request:
  workflow_dispatch:

jobs:
  build:
    runs-on: blacksmith-4vcpu-ubuntu-2404
    steps:
      - uses: actions/checkout@v4

      - uses: ./.github/actions/setup-bun

      - name: Build
        run: bun run build

      - name: Test
        run: bun test
```

### Best Practices

1. **Use Blacksmith runners** for faster builds
2. **Cache dependencies** (Bun, Rust, etc.)
3. **Use matrix builds** for multi-platform
4. **Add `workflow_dispatch`** for manual triggers
5. **Use reusable actions** from `.github/actions/`
6. **Set appropriate timeouts**
7. **Use concurrency** to prevent duplicate runs:
   ```yaml
   concurrency:
     group: ${{ github.workflow }}-${{ github.ref }}
     cancel-in-progress: true
   ```

---

## Monitoring

### GitHub Actions Dashboard

- View all workflow runs: `Actions` tab
- Filter by workflow, branch, or status
- Download artifacts from completed runs

### Notifications

- **Discord:** Release notifications via `notify-discord.yml`
- **GitHub:** Watch the repository for workflow notifications

### Usage Limits

| Resource | Limit |
|----------|-------|
| Workflow run time | 6 hours |
| Job run time | 6 hours |
| Concurrent jobs | Varies by plan |
| Artifact storage | 500MB per artifact |
| Artifact retention | 90 days |
