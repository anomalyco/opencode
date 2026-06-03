<!-- Context: core/context-paths | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

---
id: context-paths
name: Context File Path Resolution
---

# Context File Path Resolution

## Resolution Order

Context files are resolved in this order (later sources override earlier ones for conflicting keys):

1. **Global context** (`~/.config/opencode/context/`) — user-wide defaults
2. **Local context** (`/Users/apple/.config/opencode/context/` in project root) — project-specific, highest priority

This mirrors OpenCode's own config merging behavior (see [OpenCode Config Docs](https://opencode.ai/docs/config/)).

## What Goes Where

| Content Type | Recommended Location | Why |
|---|---|---|
| **Project Intelligence** (tech stack, patterns, naming) | Local `/Users/apple/.config/opencode/context/project-intelligence/` | Project-specific, committed to git, shared with team |
| **Core Standards** (code-quality, docs, tests) | Wherever OAC was installed | Universal standards, same across projects |
| **Personal Defaults** (your preferred patterns) | Global `~/.config/opencode/context/project-intelligence/` | Personal coding style across all projects |

## How Merging Works

- If a file exists in **both** local and global, the **local version wins**
- If a file exists **only** in global, it's still loaded (acts as a fallback)
- If a file exists **only** in local, it's loaded normally

**Example**: User installs OAC globally (core standards at `~/.config/opencode/context/core/`), then runs `/add-context` in a project (creates `/Users/apple/.config/opencode/context/project-intelligence/` locally). The agent loads both: core standards from global, project intelligence from local.

## Path Configuration

```json
{
  "paths": {
    "local": "/Users/apple/.config/opencode/context",
    "global": "~/.config/opencode/context"
  }
}
```

Set `"global": false` to disable global context loading.

## Environment Variable Override

The installer supports `OPENCODE_INSTALL_DIR` to override the install location:

```bash
export OPENCODE_INSTALL_DIR=~/custom/path
bash install.sh developer
```

OpenCode itself supports `OPENCODE_CONFIG_DIR` for a custom config directory (see [OpenCode docs](https://opencode.ai/docs/config/)). If set, context files in that directory are loaded alongside global and local configs.

## Migrating Global to Local

If you installed globally but want project-specific context:

```bash
/context migrate
```

This copies `project-intelligence/` from global (`~/.config/opencode/context/`) to local (`/Users/apple/.config/opencode/context/`), so your project patterns are committed to git and shared with your team. See `/context migrate` for details.

## Common Scenarios

### Scenario 1: Everything Local (Development / Repo Maintainer)
- OAC installed locally via `bash install.sh developer`
- All context in `/Users/apple/.config/opencode/context/`
- Committed to git, team shares everything

### Scenario 2: Global Install + Local Project Intelligence
- OAC installed globally via `bash install.sh developer --install-dir ~/.config/opencode`
- Core standards at `~/.config/opencode/context/core/`
- Run `/add-context` in project → creates `/Users/apple/.config/opencode/context/project-intelligence/` locally
- Project intelligence committed to git, core standards come from global

### Scenario 3: Global Personal Defaults
- Run `/add-context --global` to save personal coding patterns
- These apply to ALL projects as fallback
- Any project can override with local `/add-context`
