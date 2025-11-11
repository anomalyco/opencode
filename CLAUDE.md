# OpenCode Fork - Development Notes

## Branch: fix/permission-modal-stacking

This branch contains custom enhancements and improvements to the OpenCode project.

## Recent Changes (2025-11-11)

### Merged Upstream Changes
- Successfully merged latest upstream/dev from `sst/opencode` (172 commits)
- Resolved all merge conflicts while preserving custom features

### Merge Conflict Resolutions

**1. build.ts (packages/opencode/script/build.ts)**
- **Decision**: Kept explicit `/usr/bin/` paths with `Bun.spawn` for reliability
- **Reason**: More explicit control over build process paths

**2. session/index.tsx (packages/opencode/src/cli/cmd/tui/routes/session/index.tsx)**
- **Imports**: Merged both `DialogPermission` AND `DialogSessionRename`
- **Scroll Behavior**: Kept enhanced multi-timeout scroll implementation
  - Multiple setTimeout attempts (50ms, 150ms, 300ms) for reliable scroll-to-bottom
  - Auto-scroll when Task tool summary appears
  - Tracking last scrolled tool to prevent duplicate scrolls

**3. Tool UI Enhancements**
Kept enhanced visual feedback for Glob, Grep, and Task tools:
- Status animations (`SuccessCheckmark`, `StreamingDots`)
- Rich styled titles with theme colors and icons
- Better visual feedback during tool execution

**4. registry.ts (packages/opencode/src/tool/registry.ts)**
- **Decision**: Included BOTH `ExitPlanModeTool` AND experimental tools
- **Tools Added**: WebSearchTool, CodeSearchTool (behind feature flag)

### Development Setup

**Running from source:**
```bash
# The oc command runs from the local dev branch
oc --version  # Should show "local"

# Edit source files in packages/opencode/src/
# Changes take effect immediately (no rebuild needed for most changes)
```

**Symlink setup:**
- `/usr/local/bin/oc` → `oc-dev.sh` → runs via `bun run --cwd`
- Always runs the current branch's code
- Uses `--conditions=browser` flag for proper module resolution

## Custom Features in This Branch

### UI/UX Enhancements
- Enhanced tool animations and visual feedback
- Improved scroll behavior for better UX
- Rich styling with theme colors

### Build Improvements
- Explicit path handling in build script
- Better control over npm/tar operations

## Syncing with Upstream

To pull in new changes from upstream:

```bash
# Fetch latest from upstream
git fetch upstream

# Merge into your branch
git merge upstream/dev

# Resolve any conflicts, prioritizing:
# - Custom UI enhancements (animations, colors, UX improvements)
# - Explicit path handling in builds
# - Enhanced user-facing features
```

## Notes
- Keep `oc-dev.sh` in `.gitignore` (contains local paths)
- Always test with `oc --version` after merge conflicts
- Check for remaining conflict markers: `grep -r "<<<<<<< HEAD" packages/`
