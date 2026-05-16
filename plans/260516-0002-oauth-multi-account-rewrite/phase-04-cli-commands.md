# Phase 04 — CLI Commands

**Priority:** Medium
**Status:** DONE
**Depends on:** Phase 01 (Auth.OAuthPool, AuthBrowser must exist)

## Context Links

- Source: `packages/opencode/src/cli/cmd/auth.ts` (feature branch, 753 lines)
- Target dir: `packages/opencode/src/cli/cmd/` (dev — no `auth.ts` exists)
- Dev CLI entry: find where commands are registered (search for `AuthCommand` or `yargs.command`)

## Overview

Dev has no `auth.ts` CLI file. The feature branch `auth.ts` contains:
- `AuthCommand` — parent `auth` command
- `AuthLoginCommand` — `auth login [url]` (complex provider/plugin flow)
- `AuthLogoutCommand` — `auth logout`
- `AuthListCommand` — `auth list`
- `AuthBrowserCommand` — `auth browser` (subcommand group)
- `AuthBrowserListCommand` — `auth browser list`
- `AuthBrowserSetupCommand` — `auth browser setup [recordId]`
- `AuthBrowserRefreshCommand` — `auth browser refresh [recordId]`
- `AuthBrowserRemoveCommand` — `auth browser remove [recordId]`
- `AuthRenameCommand` — `auth rename [recordId] [name]`

**Key insight:** Dev may already have equivalent `auth login/logout/list` commands under a
different file name. Check `packages/opencode/src/cli/cmd/providers.ts` and `account.ts` on dev
to avoid duplicating existing functionality.

## Pre-check: What exists on dev

```
dev/packages/opencode/src/cli/cmd/
  account.ts    ← likely has account management
  providers.ts  ← likely has provider connect/disconnect
```

- [ ] Read `providers.ts` on dev — does it have login/logout/list equivalent?
- [ ] Read `account.ts` on dev — does it overlap?
- [ ] Identify which commands are net-new vs already present

## New Commands (definitely net-new on dev)

Based on dev CLI listing (`auth.ts` does not exist), these are all new:
1. `auth browser list` — lists browser sessions
2. `auth browser setup [recordId]` — interactive browser setup
3. `auth browser refresh [recordId]` — headless token refresh
4. `auth browser remove [recordId]` — delete profile
5. `auth rename [recordId] [name]` — rename OAuth account label

## Implementation Steps

### Step 4.1 — Create `cli/cmd/auth.ts`

Copy `auth.ts` from the feature branch. Minimal adaptation needed:

- [ ] Verify `cmd` helper import path (`./cmd` — same on dev)
- [ ] Verify `UI` import path (`../ui` — same on dev)
- [ ] Verify `Auth` import (`../../auth` — check dev alias, may be `@/auth`)
- [ ] Verify `AuthBrowser` import (`../../auth/browser` or `@/auth/browser`)
- [ ] Verify `ModelsDev` import — dev uses `@opencode-ai/core/models`, not `../../provider/models`
- [ ] Verify `Config` import path on dev
- [ ] Verify `Plugin` import path on dev
- [ ] Verify `Instance` import path on dev (`@/project/instance` or `../../project/instance`)
- [ ] Verify `Process` import path (`@/util/process` or `../../util/process`)
- [ ] Fix any import path differences using dev's `@/` alias convention

**Import path mapping (feature → dev):**
```
"../../auth"               → "@/auth"
"../../auth/browser"       → "@/auth/browser"
"../../provider/models"    → "@opencode-ai/core/models"  (ModelsDev)
"../../config/config"      → "@/config/config"
"../../global"             → "@opencode-ai/core/global"
"../../plugin"             → "@/plugin"
"../../project/instance"   → "@/project/instance"
"../../util/process"       → "@/util/process"
```

### Step 4.2 — File size modularization

`auth.ts` is 753 lines — split it:

```
cli/cmd/auth.ts                    — AuthCommand, AuthLoginCommand, AuthLogoutCommand, AuthListCommand (~200 lines)
cli/cmd/auth-browser-commands.ts   — AuthBrowserCommand + 4 subcommands (~250 lines)
cli/cmd/auth-account-commands.ts   — AuthRenameCommand + helpers (~100 lines)
```

`auth.ts` imports and re-exports from the split files.

### Step 4.3 — Register `AuthCommand` in CLI entry point

Find the CLI bootstrap file that registers top-level commands:

- [ ] Search for where other `*Command` exports are registered (e.g. `AuthLoginCommand`, `MCP`, etc.)
- [ ] Likely in `packages/opencode/src/cli/bootstrap.ts` or main CLI entry
- [ ] Add `AuthCommand` import and `.command(AuthCommand)` registration

**Pattern (from feature branch bootstrap):**
```typescript
import { AuthCommand } from "./cmd/auth"
// ... inside yargs setup:
.command(AuthCommand)
```

### Step 4.4 — Handle dev-specific `Instance.provide` pattern

Feature branch uses `Instance.provide({ directory, fn })` in `AuthLoginCommand`. Verify this
API exists on dev — if not, use the equivalent Effect-based instance initialization pattern.

### Step 4.5 — Verify `@clack/prompts` and `prompts.autocomplete`

Feature branch uses `prompts.autocomplete` (a non-standard clack extension). Verify it is
available on dev. If not, replace with `prompts.select` with manual filtering.

## Todo Checklist

- [ ] 4.0 Read `providers.ts` and `account.ts` on dev to check existing command overlap
- [ ] 4.1 Create `cli/cmd/auth.ts` (core commands)
- [ ] 4.2 Create `cli/cmd/auth-browser-commands.ts` (browser subcommands)
- [ ] 4.3 Create `cli/cmd/auth-account-commands.ts` (rename command)
- [ ] 4.4 Register `AuthCommand` in CLI bootstrap
- [ ] 4.5 Fix all import paths to use dev `@/` aliases
- [ ] 4.6 Verify `Instance.provide` API compatibility
- [ ] Compile check: `bun tsc --noEmit`
- [ ] Manual test: `opencode auth browser list` (should show empty list or configured sessions)
- [ ] Manual test: `opencode auth rename` (should prompt for account selection)

## Success Criteria

- `opencode auth --help` shows: `login`, `logout`, `list`, `browser`, `rename`
- `opencode auth browser --help` shows: `list`, `setup`, `refresh`, `remove`
- `opencode auth browser list` returns current browser sessions
- `opencode auth rename` prompts correctly and updates the label
- No TypeScript errors

## Risk Assessment

- **Duplicate commands**: if dev already has `auth login` under `providers.ts`, importing `AuthLoginCommand` may conflict — resolve by omitting the duplicate and only adding net-new commands
- **`prompts.autocomplete`**: may not exist on older `@clack/prompts` version — check dev's package.json
- **`Instance.provide`**: if API changed on dev, `AuthLoginCommand` needs adaptation (most complex command)
- **CLI bootstrap location**: dev may register commands differently — search for `yargs.command` calls
