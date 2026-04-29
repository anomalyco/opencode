# Upstream Sync Guide

Lash is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). This document describes how to merge upstream changes into the `lash` branch.

## Overview

- **Upstream remote**: `upstream` → `https://github.com/anomalyco/opencode.git`
- **Target branch**: `lash`
- **Merge target**: `upstream/dev`

## Quick Sync (recurring)

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Merge (no fast-forward, no auto-commit so conflicts can be resolved)
git merge upstream/dev --no-commit --no-ff

# 3. Resolve conflicts (see "Conflict Playbook" below)
# ... fix files ...

# 4. Regenerate lockfile
bun install

# 5. Stage and commit
git add -A
git commit -m "merge: bring upstream dev into lash"
```

## Conflict Playbook

Every upstream merge tends to produce the same categories of conflicts. This section documents how to resolve each.

---

### 1. Package version conflicts (`packages/*/package.json`, `sdks/vscode/package.json`)

**Pattern**: `version` field differs between lash (`1.7.x`) and upstream (`1.x.x`).

**Resolution**: Keep **lash's version** (`1.7.x`). All packages are versioned together.

```bash
# Automated fix — keep lash version:
for f in packages/*/package.json sdks/vscode/package.json; do
  python3 -c "
import re, sys
content = open('$f').read()
content = re.sub(
  r'<<<<<<< HEAD\n  \"version\": \"(1\.7\.[^\"]+)\",\n.*?>>>>>>> upstream/dev\n',
  r'  \"version\": \"\1\",\n',
  content, flags=re.DOTALL
)
open('$f', 'w').write(content)
"
done
```

---

### 2. Root `package.json` — patchedDependencies

**Pattern**: Upstream replaces the `patchedDependencies` entries; lash adds a `funding` block.

**Resolution**: Take **upstream's patches** + keep lash's **`funding` block**.

---

### 3. `packages/extensions/zed/extension.toml`

**Pattern**: Version + archive URLs differ.

**Resolution**: Keep **lash's version** (the archive URLs point to anomalyco/opencode — update them to `lacymorrow/lash` when publishing to Zed marketplace).

---

### 4. `packages/sdk/js/src/v2/gen/types.gen.ts`

**Pattern**: Upstream reorganizes generated types; lash adds `EventCwdUpdated`.

**Resolution**:
1. Take the upstream's large block that reorganizes types (keep nothing from our HEAD section except `EventCwdUpdated`)
2. Add `EventCwdUpdated` to the `Event` union type after `EventPermissionReplied`

```typescript
// Keep this type definition:
export type EventCwdUpdated = {
  type: "cwd.updated"
  properties: {
    cwd: string
  }
}

// In the Event union, add:
  | EventCwdUpdated
```

---

### 5. `packages/opencode/src/server/server.ts`

**Pattern**: Upstream reorganizes imports.

**Resolution**: Take **upstream's empty section** (upstream moved imports to other files). Our old `getCwd, CwdEvent` import here was stale and unused.

---

### 6. `packages/opencode/src/tool/bash.ts`

**Pattern**: The `cwd` variable in `execute()`.

**Resolution**: Combine both — use `getCwd()` and `resolvePath()` together:

```typescript
// WRONG (upstream only):
const cwd = params.workdir ? await resolvePath(params.workdir, Instance.directory, shell) : Instance.directory

// WRONG (lash only):
const cwd = params.workdir || getCwd()

// CORRECT (combined):
const cwd = params.workdir ? await resolvePath(params.workdir, getCwd(), shell) : getCwd()
```

---

### 7. `packages/opencode/src/session/prompt.ts` (MAJOR)

Upstream completely rewrites this file using Effect patterns (1907 lines vs the old ~2500 line async/await version).

**Resolution**: Take **upstream's entire version** (`git checkout --theirs`), then apply lash changes:

```bash
git checkout --theirs packages/opencode/src/session/prompt.ts
```

Then manually add:

**a) Import (after `import { Shell } from "@/shell/shell"`):**
```typescript
import { getCwd, setCwd, detectNaturalLanguage } from "@shell-mode"
```

**b) Replace `ctx.directory` with `getCwd()` in all path objects:**
```python
python3 -c "
content = open('packages/opencode/src/session/prompt.ts').read()
content = content.replace('path: { cwd: ctx.directory, root: ctx.worktree }', 'path: { cwd: getCwd(), root: ctx.worktree }')
open('packages/opencode/src/session/prompt.ts', 'w').write(content)
"
```

**c) In the bash execution function, change `const cwd = ctx.directory` to `const cwd = getCwd()`**

**d) Replace the simple bash invocations with sentinel-wrapped versions** that output the new cwd after each command, then parse and call `setCwd(newCwd)` in the `finish` Effect.

**e) Add `detectNaturalLanguage()` call in the finish Effect** after parsing the sentinel.

See commit `e95356aec` for the full diff of these changes.

---

### 8. `packages/opencode/src/cli/cmd/tui/app.tsx`

**Pattern**: Upstream adds `createCliRenderer`, `TuiPluginRuntime`, plugin system.

**Resolution**:
1. Take **both** imports (lash's `ExecutionModeProvider, WorkingDirProvider` AND upstream's `createTuiApi, TuiPluginRuntime`)
2. Take **upstream's render tree** but add our providers around `<App />`:

```tsx
<PromptRefProvider>
  <ExecutionModeProvider>    {/* lash addition */}
    <WorkingDirProvider>     {/* lash addition */}
      <App onSnapshot={input.onSnapshot} />
    </WorkingDirProvider>
  </ExecutionModeProvider>
</PromptRefProvider>
```

---

### 9. `packages/opencode/src/cli/cmd/tui/routes/home.tsx`

**Pattern**: Upstream adds `TuiPluginRuntime.Slot` wrappers for extensibility.

**Resolution**: Take **upstream's structure** (with plugin slots and `placeholders` prop) and add `showWorkingDirectory={false}` to the Prompt in the `home_prompt` slot.

---

### 10. `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` (MAJOR)

**Resolution**: Take **upstream's version** (`git checkout --theirs`), then add:

1. `RGBA` to opentui/core imports
2. `DialogExecutionMode` import
3. `@tui-integration` imports (`useExecutionMode`, `handleModeToggleKey`, `determineRouting`, shell completion hooks)
4. `ExecutionMode` from `@shell-mode`
5. `showWorkingDirectory?: boolean` prop
6. `completionCycle: CompletionCycleState | null` in store type + init
7. `executionMode = useExecutionMode()` context in function body
8. `shortenedWorkingDir` computed memo
9. `modePrefixColor` computed memo
10. `determineRouting()` in submit function (replaces `store.mode === "shell"` check)
11. `handleModeToggleKey()` in `onKeyDown` handler
12. `DialogExecutionMode` in command registry
13. Working directory display in footer fallback
14. Mode toggle hint in footer hints area

**Double left border** — upstream only has a single border. Add the execution mode inner border using a **row layout** (not nested borders — see below):

```tsx
<box border={["left"]} borderColor={borderHighlight()} customBorderChars={{...SplitBorder.customBorderChars, bottomLeft: "╹"}}>
  <box flexDirection="row">
    <box
      width={1}
      alignSelf="stretch"
      border={["left"]}
      borderColor={modePrefixColor()}
      customBorderChars={{ ...SplitBorder.customBorderChars }}
    />
    <box paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0} backgroundColor={theme.backgroundElement} flexGrow={1}>
      {/* textarea + footer */}
    </box>
  </box>
</box>
```

> **Why row layout?** Nesting `border={["left"]}` boxes causes the inner border to appear 1–2 rows shorter than the outer because Yoga sizes each box independently. Using `width={1}` + `alignSelf="stretch"` in a row container guarantees both bars span identical rows.

---

### 12. `packages/opencode/src/config/keybinds.ts`

**Pattern**: Upstream may reassign `agent_cycle` to `tab`. Lash remaps Tab to shell autocomplete.

**Resolution**: Ensure `agent_cycle` is on `shift+tab`, NOT `tab`:

```typescript
agent_cycle: keybind("shift+tab", "Next agent"),
agent_cycle_reverse: keybind("none", "Previous agent"),
```

Tab is handled in `onKeyDown` in `prompt/index.tsx` via `handleShellTabCompletion()`.

---

### 13. `bun.lock`

**Resolution**: Always regenerate after resolving all `package.json` conflicts:
```bash
bun install
git add bun.lock
```

---

## Post-Merge QA Checklist

Run through this visually after every merge commit, before closing the sync issue.

### Prompt border
- [ ] Two left border bars visible: outer bar = agent color, inner bar = execution mode color
- [ ] Both bars are the **same height** — no gap at top or bottom of the inner bar
- [ ] Outer bar shows a `╹` connector at the bottom join

### Keybinds
- [ ] **Tab** → triggers shell autocomplete (shows completions or cycles them)
- [ ] **Shift+Tab** → cycles agents (Build → Plan → …)
- [ ] **Ctrl+Space** → cycles execution modes (agent → shell → auto)
- [ ] **Enter** → submits prompt; **Shift+Enter** → inserts newline

### Execution mode indicator
- [ ] Footer shows mode name in execution mode color (e.g. `ctrl+space agent`)
- [ ] Switching modes updates both the inner border color and the footer label

### Shell mode
- [ ] Typing `!` at start of prompt switches to shell mode (blue border)
- [ ] Pressing Escape from shell mode returns to normal mode
- [ ] Running a command in shell mode updates the working directory in the footer

### Working directory
- [ ] Footer left side shows shortened cwd (e.g. `~/repo/lash`)
- [ ] Running `cd <dir>` in shell mode updates the displayed cwd

### Typecheck
```bash
cd packages/opencode && bun run typecheck
```
Zero errors required before closing the sync issue.

---

## What Lash Preserves (invariants)

These features must always be preserved through upstream merges:

| Feature | Files | Purpose |
|---------|-------|---------|
| `getCwd()` / `setCwd()` | `plugin/shell-mode/cwd.ts` | Shell cwd tracking |
| `detectNaturalLanguage()` | `plugin/shell-mode/natural-language.ts` | NL detection |
| `ExecutionMode` (shell/agent/auto) | `plugin/shell-mode/mode.ts` | Mode switching |
| `ExecutionModeProvider` | `plugin/tui-integration/execution-mode-provider.tsx` | TUI context |
| `WorkingDirProvider` | `plugin/tui-integration/working-dir-provider.tsx` | TUI cwd display |
| `handleModeToggleKey()` | `plugin/tui-integration/hooks.ts` | ctrl+space handler |
| `determineRouting()` | `plugin/tui-integration/hooks.ts` | Shell vs agent routing |
| `cwd sentinel` in bash | `src/session/prompt.ts` | Cwd tracking after cd |
| `mode_toggle` keybind | `src/config/config.ts` | ctrl+space default |
| `agent_cycle` keybind | `src/config/keybinds.ts` | shift+tab (NOT tab) |
| Double left border | `component/prompt/index.tsx` | Row layout, not nested |
| `EventCwdUpdated` | `sdk/js/src/v2/gen/types.gen.ts` | SDK type for cwd event |
| cwd in `path.*` field | `src/session/prompt.ts` | Shows cwd in messages |

## Automating the Sync (future)

To automate weekly syncs, add a GitHub Action:

```yaml
# .github/workflows/upstream-sync.yml
name: Upstream Sync
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday 6am UTC
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          fetch-depth: 0
      - run: git remote add upstream https://github.com/anomalyco/opencode.git
      - run: git fetch upstream
      - run: git config user.email "lacy@example.com"
      - run: git config user.name "Lacy Bot"
      - run: |
          git merge upstream/dev --no-commit --no-ff || true
          # Check if there are conflicts
          if git diff --name-only --diff-filter=U | grep -q .; then
            echo "CONFLICTS=true" >> $GITHUB_ENV
          fi
      - name: Open PR if merge succeeds
        if: env.CONFLICTS != 'true'
        run: |
          git commit -m "chore: merge upstream dev"
          git push origin HEAD:upstream-sync-$(date +%Y%m%d)
          gh pr create --title "Upstream sync $(date +%Y-%m-%d)" ...
```

For conflict-free or simple merges, this can be fully automated. Conflicted merges (like `prompt.ts` refactors) require manual resolution — create a PR instead and resolve manually.

## Sync History

| Date | Upstream commits merged | Conflicts | Notes |
|------|------------------------|-----------|-------|
| 2026-04-02 | 673 (cf7ca9b2f → 92e820fdc) | 28 files | Major Effect rewrite of prompt.ts |
| 2026-04-28 | (QA only — no new merge) | — | LAC-163: found 3 regressions post-merge: missing double border, wrong Tab keybind, border height mismatch. Fixed in commits bde00fa30, 85faf49fc, 9d7ac27c1. Added this QA checklist. |
