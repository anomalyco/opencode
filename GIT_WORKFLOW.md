# Git Workflow & Push Rules

## Repository Structure

This repo has multiple remotes with different purposes:

```
origin       → https://github.com/sst/opencode.git (PUBLIC - upstream)
fork         → git@github.com:stevenvo/opencode.git (PUBLIC - your fork)
geocomply    → git@github.com:GeoComply/opencode.git (PRIVATE - GeoComply fork)
haoxiangliew → https://github.com/haoxiangliew/opencode.git (PUBLIC - reference)
```

## Branch Structure

**GeoComply Private Branches:**

- `geocomply/main` - Stable/production branch (for npm package builds)
- `geocomply/dev` - Active development branch (your daily work)

**Public Upstream Mirror:**

- `upstream-dev` - Local mirror of `origin/dev` (sst/opencode public repo)
- Pull latest public changes here, then sync to private branches

**Personal Branches:**

- `steven/*` - Your experimental/personal work branches

## Push Rules (Enforced by pre-push hook)

### ✅ ALLOWED

**To `geocomply` remote (GeoComply private repo):**

- ✅ `geocomply-dev` branch (main private development branch)
- ✅ `feature/*` branches (new features)
- ✅ `fix/*` branches (bug fixes)
- ✅ `chore/*` branches (maintenance)
- ✅ `docs/*` branches (documentation)
- ✅ `steven/*` branches (personal work)

### ❌ BLOCKED

**Cannot push to:**

- ❌ `origin` (sst/opencode) - public upstream
- ❌ `fork` (stevenvo/opencode) - your public fork
- ❌ `haoxiangliew` - reference remote
- ❌ `dev`, `main`, `master` branches to any remote

## Workflows

### Workflow 1: Private Development (GeoComply only)

For features/fixes that stay private:

```bash
# Work on dev branch
git checkout dev
# ... make changes ...
git add .
git commit -m "feat: add private feature"
git push geocomply dev
```

### Workflow 2: Sync Public Upstream Changes

Pull latest from public repo and merge into private:

```bash
# Update upstream mirror
git checkout upstream-dev
git pull origin dev

# Merge into private main
git checkout main  # or create branch from main
git merge upstream-dev
# Resolve conflicts if any

# Push to private repo
git push geocomply main
```

### Workflow 3: Feature Branch (Private)

For organized private development:

```bash
# Create feature branch from dev
git checkout dev
git checkout -b feature/my-feature

# ... make changes ...
git add .
git commit -m "feat: implement my feature"
git push geocomply feature/my-feature

# Create PR on GitHub: feature/my-feature → geocomply/dev
# After merge, delete branch
```

### Workflow 4: Contributing to Public Upstream

For features that should go to public sst/opencode:

```bash
# Start from latest public upstream
git checkout upstream-dev
git pull origin dev
git checkout -b feature/public-contribution

# ... make changes ...
git add .
git commit -m "feat: public feature"

# Push to your PUBLIC fork (NOT directly)
git push fork feature/public-contribution

# Create PR on GitHub: stevenvo/opencode:feature/public-contribution → sst/opencode:dev
```

### Workflow 5: Both Private AND Public

For features that need to be in both repos:

```bash
# 1. Develop on private first
git checkout dev
git checkout -b feature/shared-feature
# ... make changes ...
git commit -m "feat: shared feature"
git push geocomply feature/shared-feature

# 2. Create PR to geocomply/dev, merge it

# 3. Cherry-pick or rebase for public contribution
git checkout upstream-dev
git pull origin dev
git checkout -b feature/shared-feature-public
git cherry-pick <commit-hash>  # or rebase onto upstream-dev

# 4. Push to your fork for public PR
git push fork feature/shared-feature-public

# 5. Create PR: stevenvo/opencode:feature/shared-feature-public → sst/opencode:dev
```

## Branch Naming Convention

| Pattern         | Purpose                  | Example              |
| --------------- | ------------------------ | -------------------- |
| `geocomply-dev` | Main private development | `geocomply-dev`      |
| `feature/*`     | New features             | `feature/1m-context` |
| `fix/*`         | Bug fixes                | `fix/session-crash`  |
| `chore/*`       | Maintenance              | `chore/update-deps`  |
| `docs/*`        | Documentation            | `docs/update-readme` |
| `steven/*`      | Personal branches        | `steven/experiment`  |

## Publishing Packages

### Private NPM Package (@geocomply/opencode)

```bash
# From geocomply-dev branch
cd packages/opencode
npm version patch  # or minor/major
npm publish
```

See `packages/opencode/PUBLISHING.md` for details.

## Safety Features

### Pre-push Hook

Located at `.husky/pre-push`, this hook:

1. **Blocks direct pushes** to public repos (origin, fork)
2. **Allows only approved branches** to geocomply remote
3. **Warns on non-standard** branch names
4. **Provides helpful guidance** when blocked

### Override (Emergency Use Only)

To bypass the hook (NOT recommended):

```bash
git push --no-verify geocomply geocomply-dev
```

## Quick Reference

```bash
# Check current remote setup
git remote -v

# Check current branch
git branch --show-current

# See which remote a branch tracks
git branch -vv

# Safe push to private repo
git push geocomply geocomply-dev

# BLOCKED - will fail
git push origin dev
git push fork main
```

## Questions?

- **"I want to work on a private feature"** → Use `geocomply-dev` or `feature/*` branch
- **"I want to contribute upstream"** → Use `feature/*` branch, push to `fork`, create PR to `origin`
- **"I need both private and public"** → Develop on `geocomply-dev`, cherry-pick to public branch
- **"Push was blocked, why?"** → Check the error message, it tells you what to do

## Summary

**Golden Rule:**

- `geocomply` remote = private development (always allowed)
- `origin`/`fork` remotes = public contributions (only via PRs, never direct push)
