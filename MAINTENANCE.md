# Fork Maintenance Guide

This document explains how to maintain this fork of opencode, including syncing with upstream and resolving conflicts.

## 🎯 Our Goals

1. **Maintain minimal mode as default**: Our fork always starts in REPL mode
2. **Stay updated**: Regular sync with upstream for new features and bug fixes
3. **Minimize conflicts**: Keep our changes minimal to reduce merge conflicts

## 🔄 Syncing with Upstream

### Automatic Sync (Recommended)

We have a GitHub Actions workflow that syncs with upstream every Monday:

- **Workflow**: `.github/workflows/sync-upstream.yml`
- **Schedule**: Every Monday at 00:00 UTC
- **Manual trigger**: You can also trigger it manually from the Actions tab

### Manual Sync

If you need to sync manually:

```bash
# Run the sync script
./scripts/sync-upstream.sh

# Or do it manually:
git fetch upstream
git merge upstream/dev
```

## ⚠️ Handling Merge Conflicts

### Common Conflict Areas

1. **`packages/opencode/src/cli/cmd/tui/thread.ts`**
   - This file contains our minimal mode logic
   - **Resolution**: Keep our version (`git checkout --ours`)

2. **`README.md`**
   - Our custom documentation
   - **Resolution**: Keep our version (`git checkout --ours`)

### Conflict Resolution Script

```bash
#!/bin/bash
# resolve-conflicts.sh

# Keep our version of key files
git checkout --ours packages/opencode/src/cli/cmd/tui/thread.ts
git checkout --ours README.md

# Stage resolved files
git add packages/opencode/src/cli/cmd/tui/thread.ts
git add README.md

# Commit
git commit -m "merge: resolve conflicts, preserve minimal mode"
```

## 📋 Files We Customize

| File | Purpose | Conflict Resolution |
|------|---------|---------------------|
| `packages/opencode/src/cli/cmd/tui/thread.ts` | Minimal mode logic | Keep ours |
| `README.md` | Our documentation | Keep ours |
| `.github/workflows/build-cli.yml` | Build workflow | Keep ours |
| `.github/workflows/sync-upstream.yml` | Sync workflow | Keep ours |
| `scripts/sync-upstream.sh` | Sync script | Keep ours |

## 🚀 Release Process

### 1. Sync with Upstream

```bash
./scripts/sync-upstream.sh
```

### 2. Test Changes

```bash
# Run typecheck
bun run typecheck

# Test locally
cd packages/opencode
bun run script/build.ts --single
```

### 3. Create Release

```bash
# Tag the release
git tag v0.1.0-minimal

# Push tag
git push origin v0.1.0-minimal

# GitHub Actions will automatically build binaries
```

## 🔧 Development Workflow

### Adding New Features

1. **Create a branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes**
   - Keep changes minimal
   - Focus on minimal mode enhancements

3. **Test**
   ```bash
   bun run typecheck
   ```

4. **Submit PR**
   - Target: `main` branch of this fork
   - Description: Explain what the feature does

### Syncing Feature Branches

If you have a feature branch and need to sync with upstream:

```bash
# Update main branch
git checkout main
git fetch upstream
git merge upstream/dev

# Rebase your feature branch
git checkout feature/my-feature
git rebase main
```

## 📊 Monitoring

### Check Sync Status

```bash
# See how many commits behind upstream
git rev-list --count HEAD..upstream/dev

# See what's changed upstream
git log --oneline HEAD..upstream/dev
```

### Check Build Status

- **Build workflow**: https://github.com/iamcheyan/opencode/actions
- **Latest release**: https://github.com/iamcheyan/opencode/releases

## 🆘 Troubleshooting

### Problem: Merge conflicts in thread.ts

**Solution**:
```bash
git checkout --ours packages/opencode/src/cli/cmd/tui/thread.ts
git add packages/opencode/src/cli/cmd/tui/thread.ts
git commit -m "merge: resolve conflict, keep minimal mode"
```

### Problem: Build fails after sync

**Solution**:
```bash
# Clean and rebuild
rm -rf node_modules
bun install
bun run typecheck
```

### Problem: Sync workflow fails

**Solution**:
1. Check the Actions tab for error details
2. Usually it's a conflict that needs manual resolution
3. Run `./scripts/sync-upstream.sh` locally
4. Resolve conflicts manually
5. Push the resolved merge

## 📞 Getting Help

- **Issues**: https://github.com/iamcheyan/opencode/issues
- **Discussions**: https://github.com/iamcheyan/opencode/discussions
- **Upstream**: https://github.com/anomalyco/opencode

## 🎉 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a PR

Focus areas:
- Improving minimal mode
- Adding new slash commands
- Performance optimizations
- Better terminal compatibility
