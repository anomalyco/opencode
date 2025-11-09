# CodeSurf Migration Guide

## Overview

CodeSurf has been migrated from using `.opencode` folders to `.codesurf` folders by default, while maintaining full backward compatibility with OpenCode installations through an environment variable system.

## Migration Status: ✅ COMPLETE

All tests passing (14/14) ✓

---

## For New Users (Default Behavior)

CodeSurf installs to `.codesurf` folders by default:

- **Global config**: `~/.config/codesurf/`
- **Global data**: `~/.local/share/codesurf/`
- **Project config**: `.codesurf/` in your project root
- **Config files**: `codesurf.json`, `codesurf.jsonc` (with `opencode.json` fallback)

No configuration needed - just install and use!

---

## For OpenCode Users

### Option A: Share Settings with OpenCode (Compatibility Mode)

Use this if you want to:

- Share sessions between CodeSurf and OpenCode
- Use the same configuration files
- Keep a single installation

**Setup:**

```bash
export CODESURF_FOLDER=".opencode"
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
echo 'export CODESURF_FOLDER=".opencode"' >> ~/.zshrc
```

**What happens:**

- Uses `.opencode/` folders in projects
- Uses `~/.config/opencode/` for global config
- Uses `~/.local/share/opencode/` for global data
- Sessions are shared between CodeSurf and OpenCode
- Only loads `opencode.json`/`opencode.jsonc` files
- CodeSurf-specific features stored separately in `~/.local/share/codesurf-extensions/`

**Limitations:**

- Cannot use CodeSurf-specific config schema extensions in `.opencode` folders
- Must follow OpenCode schema strictly to avoid breaking OpenCode

---

### Option B: Standalone Installation (Recommended)

Use this if you want:

- Independent CodeSurf installation
- Full CodeSurf features without restrictions
- Separate sessions from OpenCode

**Setup:**
No environment variable needed (default behavior)

**Migrating from OpenCode:**

1. Your existing `opencode.json` files will still be loaded as fallback
2. Create `codesurf.json` files to override specific settings
3. Existing `.opencode/` folders will be discovered and loaded
4. New agents/commands/plugins should go in `.codesurf/` folders

**What happens:**

- Creates `.codesurf/` folders in projects
- Uses `~/.config/codesurf/` for global config
- Uses `~/.local/share/codesurf/` for global data
- Loads both `opencode.json` AND `codesurf.json` (codesurf takes precedence)
- Discovers both `.opencode/` and `.codesurf/` folders (codesurf takes precedence)
- Full CodeSurf feature set available

---

## Configuration File Precedence

### In Default Mode (CODESURF_FOLDER not set or set to `.codesurf`):

Config files loaded in order (last wins):

1. `opencode.jsonc`
2. `opencode.json`
3. `codesurf.jsonc`
4. `codesurf.json` ← Takes precedence

Directory discovery order:

1. `.opencode/` (if exists)
2. `.codesurf/` ← Takes precedence

### In Compatibility Mode (CODESURF_FOLDER=".opencode"):

Config files loaded in order:

1. `opencode.jsonc`
2. `opencode.json`

Directory discovery:

1. `.opencode/` only

---

## Environment Variables

### `CODESURF_FOLDER`

**Default:** `.codesurf`

Controls which folder name to use for project-level configuration.

**Values:**

- `.codesurf` (default) - Independent CodeSurf installation
- `.opencode` - OpenCode compatibility mode
- Custom value - Use your own folder name

**Examples:**

```bash
# Default (CodeSurf mode)
codesurf

# OpenCode compatibility
CODESURF_FOLDER=".opencode" codesurf

# Custom folder
CODESURF_FOLDER=".myconfig" codesurf
```

### `CODESURF_COMPATIBILITY_MODE` (Auto-detected)

**Read-only** - Automatically set to `true` when `CODESURF_FOLDER=".opencode"`

---

## Directory Structure

### Default Mode (`.codesurf`)

```
~/
  .config/codesurf/
    agent/           # Global agents
    command/         # Global commands
    plugin/          # Global plugins
    codesurf.json    # Global config

  .local/share/codesurf/
    storage/         # Sessions, messages
    bin/             # Binaries
    log/             # Logs

/your/project/
  .codesurf/
    agent/           # Project agents
    command/         # Project commands
    plugin/          # Project plugins
    tool/            # Project tools
  codesurf.json      # Project config
```

### Compatibility Mode (`.opencode`)

```
~/
  .config/opencode/
    agent/
    command/
    plugin/
    opencode.json

  .local/share/opencode/
    storage/         # Shared with OpenCode!
    bin/
    log/

  .local/share/codesurf-extensions/
    # CodeSurf-specific features only

/your/project/
  .opencode/
    agent/
    command/
    plugin/
    tool/
  opencode.json
```

---

## Server Ports

- **Default Mode**: Port 42068
- **Compatibility Mode**: Port 42069 (to avoid conflicts with OpenCode)

This allows running both CodeSurf and OpenCode servers simultaneously in compatibility mode.

---

## Migration Checklist

If migrating from OpenCode to standalone CodeSurf:

- [ ] Decide: Compatibility mode or standalone?
- [ ] Set `CODESURF_FOLDER` environment variable (if compatibility mode)
- [ ] Create `.codesurf/` folders for new configuration (if standalone)
- [ ] Copy/adapt agents, commands, plugins to `.codesurf/` folders (optional)
- [ ] Create `codesurf.json` for CodeSurf-specific settings (optional)
- [ ] Test: Run `codesurf` and verify configuration loads correctly
- [ ] Update CI/CD scripts with `CODESURF_FOLDER` if needed

---

## FAQ

### Q: Will my existing OpenCode projects still work?

**A:** Yes! CodeSurf will automatically discover and load `.opencode/` folders and `opencode.json` files as fallback.

### Q: Can I use both CodeSurf and OpenCode on the same project?

**A:** Yes, if you use compatibility mode (`CODESURF_FOLDER=".opencode"`). Sessions will be shared.

### Q: What if I have both `.codesurf/` and `.opencode/` folders?

**A:** Both are loaded, but `.codesurf/` takes precedence. This allows gradual migration.

### Q: Can I switch between modes?

**A:** Yes, just change the `CODESURF_FOLDER` environment variable. No data loss.

### Q: How do I know which mode I'm in?

**A:** Check your environment:

```bash
echo $CODESURF_FOLDER
# Empty or .codesurf = CodeSurf mode
# .opencode = Compatibility mode
```

### Q: What happens to my existing sessions?

**A:** They remain in place:

- Compatibility mode: Sessions stay in `~/.local/share/opencode/`
- Default mode: New sessions in `~/.local/share/codesurf/`

---

## Technical Details

### Files Modified

1. `src/flag/flag.ts` - Added `CODESURF_FOLDER` and `CODESURF_COMPATIBILITY_MODE`
2. `src/global/index.ts` - Dynamic app name based on environment
3. `src/storage/schema-manager.ts` - NEW: Schema routing for features
4. `src/config/config.ts` - Dynamic directory discovery and config loading
5. `src/file/ripgrep.ts` - Ignore both `.opencode` and `.codesurf`
6. `src/cli/cmd/memory.ts` - Dynamic memory file path
7. `src/cli/cmd/tui/component/dialog-memory-*.tsx` - Dynamic memory paths
8. `src/cli/cmd/agent.ts` - Dynamic agent folder path
9. `src/installation/index.ts` - Detect both bin directories

### Tests

- `test/migration/codesurf-migration.test.ts` - Comprehensive migration tests
- **Status**: ✅ All tests passing (14/14)

---

## Rollback Plan

If you need to revert to OpenCode-only behavior:

```bash
export CODESURF_FOLDER=".opencode"
```

Or uninstall CodeSurf and reinstall OpenCode.

---

## Support

For issues or questions:

- Check logs: `~/.local/share/codesurf/log/` or `~/.local/share/opencode/log/`
- Verify environment: `echo $CODESURF_FOLDER`
- Test configuration: `codesurf config list`

---

**Migration completed successfully! 🎉**
