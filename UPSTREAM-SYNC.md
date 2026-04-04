# Manual Upstream Sync Guide

This fork (xcsh) tracks [anomalyco/opencode](https://github.com/anomalyco/opencode) as its upstream. Because the fork has diverged significantly (directory rename, npm scope change, env var rename), automated sync is no longer viable. All upstream integration is done manually with careful review.

## Prerequisites

Ensure the upstream remote is configured:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git 2>/dev/null
git fetch upstream dev
```

## Sync Process

### 1. Assess divergence

```bash
# Read the last synced position
cat .github/UPSTREAM_SYNC_POSITION

# Count new upstream commits since last sync
git rev-list --count <LAST_SYNCED_SHA>..upstream/dev

# List them
git log --oneline <LAST_SYNCED_SHA>..upstream/dev
```

### 2. Create a sync branch

```bash
git checkout dev
git pull origin dev
git checkout -b sync/upstream-$(date +%Y-%m-%d)
```

### 3. Apply upstream changes with path rewriting

For each upstream commit (or batch), generate a patch with path translation:

```bash
git format-patch -1 <SHA> --stdout \
  | sed 's|packages/opencode/|packages/xcsh/|g' \
  | sed 's|@opencode-ai/opencode|@f5xc-salesdemos/xcsh|g' \
  | sed 's|@opencode-ai/sdk|@f5xc-salesdemos/sdk|g' \
  | sed 's|@opencode-ai/plugin|@f5xc-salesdemos/plugin|g' \
  | git apply --3way
```

For bulk application of non-conflicting commits:

```bash
git format-patch <LAST_SYNCED_SHA>..upstream/dev --stdout \
  | sed 's|packages/opencode/|packages/xcsh/|g' \
  | sed 's|@opencode-ai/opencode|@f5xc-salesdemos/xcsh|g' \
  | sed 's|@opencode-ai/sdk|@f5xc-salesdemos/sdk|g' \
  | sed 's|@opencode-ai/plugin|@f5xc-salesdemos/plugin|g' \
  | git apply --3way
```

If `--3way` fails on certain hunks, resolve manually and continue.

### 4. Handle additional renames

After applying patches, check for references that the sed rules don't cover:

```bash
# Env var references (fork uses XCSH_*, not OPENCODE_*)
grep -rn "OPENCODE_" --include="*.ts" packages/xcsh/src/

# Config directory references (fork uses .xcsh/, not .opencode/)
grep -rn '\.opencode' --include="*.ts" --include="*.json" packages/xcsh/

# Package name references
grep -rn "@opencode-ai/" --include="*.ts" --include="*.json" packages/

# Stale directory references
grep -rn "packages/opencode" --include="*.ts" --include="*.json" .
```

Fix any findings manually. Note: `"opencode"` as a **provider ID** string is intentionally kept — it is Anthropic's actual provider name, not a package reference.

### 5. Validate

```bash
# Run the bugfix-specific test
cd packages/xcsh && bun test test/provider/transform.test.ts --timeout 60000

# Full typecheck
cd ../.. && bun turbo typecheck

# Run unit tests
cd packages/xcsh && bun test
```

### 6. Update sync position

Edit `.github/UPSTREAM_SYNC_POSITION` with the new SHA and date.

### 7. Submit PR

```bash
git add -A
git commit -m "sync: upstream to $(git rev-parse --short upstream/dev)"
git push origin sync/upstream-$(date +%Y-%m-%d)
# Create PR targeting dev
```

After the PR is reviewed and merged into `dev`, promote to `main` when ready for release.

## Transformation Reference

| Upstream Pattern | Fork Replacement | Notes |
|---|---|---|
| `packages/opencode/` | `packages/xcsh/` | Directory path in all contexts |
| `@opencode-ai/opencode` | `@f5xc-salesdemos/xcsh` | npm package name |
| `@opencode-ai/sdk` | `@f5xc-salesdemos/sdk` | SDK npm package |
| `@opencode-ai/plugin` | `@f5xc-salesdemos/plugin` | Plugin npm package |
| `OPENCODE_*` env vars | `XCSH_*` env vars | All environment variables |
| `.opencode/` config dir | `.xcsh/` config dir | User/project config directory |
| `opencode` (provider ID) | `opencode` | **Keep as-is** — actual provider name |
| `opencode-cli` | `xcsh-cli` | npm CLI wrapper package |
| `opencode-cli-ai` | `xcsh-cli-ai` | npm CLI AI package |

## Triage Guidance

Not all upstream commits need to be adopted. Use this to prioritize:

| Category | Priority | Examples |
|---|---|---|
| Bug fixes in core logic | High | Provider transforms, session handling, message processing |
| Performance improvements | High | Batch operations, caching |
| New features | Medium | Review for relevance to fork goals |
| Effect-ification refactors | Medium | Structural changes that affect future mergeability |
| CI/CD changes | Low | Fork has its own CI; skip unless relevant |
| Docs/i18n updates | Low | Fork has its own branding; usually skip |
| Upstream-specific tooling | Skip | Upstream's own sync, triage, or deploy workflows |

## Branch Model

- `dev` — integration branch, receives upstream syncs and feature work
- `main` — stable release branch, only receives merges from `dev` after validation
- `sync/upstream-*` — temporary branches for upstream integration work
