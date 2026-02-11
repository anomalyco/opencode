# Rebase Agent Documentation

## Purpose

The Rebase Agent is an AI agent responsible for synchronizing the fork (`kyashrathore/opencode`) with upstream (`anomalyco/opencode`) by rebasing `dev` onto `upstream/dev`. When merge conflicts occur, the agent must make intelligent decisions on how to resolve them based on the project's architecture and documented conflict resolution strategies.

## Goals

1. **Automate daily upstream syncs** with minimal human intervention
2. **Intelligently resolve merge conflicts** using documented strategies
3. **Maintain extension system integrity** when upstream changes
4. **Update documentation** after each sync operation
5. **Escalate to humans** only for complex architectural conflicts

---

## Repository Configuration

### Remote Setup

```
upstream  https://github.com/anomalyco/opencode.git  (the main OpenCode repo)
origin    https://github.com/kyashrathore/opencode.git  (our fork)
```

### Branch Strategy

| Branch | Purpose | Source |
|--------|---------|--------|
| `upstream/dev` | Upstream development branch | anomalyco/opencode |
| `origin/dev` (local: `dev`) | Our development branch | kyashrathore/opencode |
| `sync/YYYY-MM-DD` | Daily sync branches | Created by agent |

---

## Pre-Rebase Checklist

Before starting a rebase, the agent must:

1. **Check existing sync branches**
   ```bash
   git branch -r | grep sync/
   ```
   - If unmerged sync branches exist, investigate or clean up first

2. **Verify remotes are accessible**
   ```bash
   git fetch upstream --dry-run 2>&1 | head -5
   git fetch origin --dry-run 2>&1 | head -5
   ```

3. **Check for WIP commits on dev**
   ```bash
   git log dev --not upstream/dev --oneline | head -20
   ```
   - Document any commits that will be replayed

4. **Review recent upstream changes**
   ```bash
   git log upstream/dev --since="24 hours ago" --oneline
   ```
   - Identify high-risk areas (extension points, modified files)

---

## The Rebase Process

### Step 1: Setup Sync Branch

```bash
# Ensure we're on latest dev
git checkout dev
git pull origin dev

# Create sync branch with timestamp
git checkout -b sync/$(date +%Y-%m-%d)

# Fetch latest upstream
git fetch upstream
```

### Step 2: Attempt Rebase

```bash
# Start rebase onto upstream/dev
git rebase upstream/dev
```

### Step 3: Handle Outcomes

#### Case A: Clean Rebase (No Conflicts)

**Do NOT skip to validation.** Proceed to the **Upstream Drift Review** section below — clean rebases can still introduce silent breakage.

#### Case B: Merge Conflicts Detected

**STOP and analyze using the Decision Tree below.**

After all conflicts are resolved and `git rebase --continue` finishes, proceed to the **Upstream Drift Review** section.

---

## Conflict Resolution Decision Tree

### Decision Tree for AI Agents

```
CONFLICT DETECTED in file X
│
├─ 1. Is X in packages/claxedo-app/?
│   └─ YES → Keep OUR changes (this is our code)
│       Action: git checkout --ours X && git add X
│
├─ 2. Is X in packages/app-shared/?
│   └─ YES → Keep OUR changes (extension system is ours)
│       Action: git checkout --ours X && git add X
│
├─ 3. Is X listed in "Upstream Modifications Registry"?
│   └─ YES → Follow the specific "Merge Strategy"
│       ├─ "Accept upstream" → git checkout --theirs X && git add X
│       ├─ "Keep ours" → git checkout --ours X && git add X
│       ├─ "Merge carefully" → Manual 3-way merge required
│       └─ Check CLAXEDO_UPSTREAM_SYNC.md for patterns
│
├─ 4. Is X a package.json?
│   └─ YES → Merge dependencies manually
│       - Keep our added dependencies
│       - Accept upstream version bumps
│       - Resolve version conflicts conservatively (use higher version)
│
├─ 5. Is X a lockfile (bun.lock, package-lock.json, etc.)?
│   └─ YES → Regenerate after package.json merge
│       Action: Accept theirs, then run 'bun install' after rebase
│
├─ 6. Is X in the "Never Modify" list?
│   └─ YES → Accept upstream entirely
│       Action: git checkout --theirs X && git add X
│       Note: If we modified it, document the deviation
│
└─ 7. DEFAULT: Accept upstream entirely
    └─ We shouldn't have modified files not in registry
    Action: git checkout --theirs X && git add X
    Note: Document this as potential new modification
```

### File Location Reference

| Path | Category | Resolution |
|------|----------|------------|
| `packages/claxedo-app/**` | Our Code | Keep ours |
| `packages/app-shared/**` | Extension System | Keep ours |
| `packages/app/**` | Upstream | Check Registry |
| `packages/opencode/**` | Upstream | Check Registry |
| `packages/desktop/**` | Upstream | Check Registry |
| `packages/ui/**` | Upstream | Accept theirs |
| `packages/sdk/**` | Upstream | Accept theirs |
| `claxedo/**` | Our Backend | Keep ours |
| `*.lock` | Generated | Regenerate |
| `package.json` | Config | Manual merge |

---

## Specific Conflict Patterns

### Pattern 1: Extension Hook Integration

**Context:** Upstream modified a file where we added extension hooks.

**Resolution Strategy:**
```typescript
// CONFLICT: Both upstream and we modified app.tsx

// STEP 1: Accept upstream changes first
git checkout --theirs packages/app/src/app.tsx

// STEP 2: Re-apply our extension integration
// Look for patterns like:
const extensions = getExtensions()
const wrapProviders = (providers, children) => 
  providers.reduceRight((acc, P) => <P>{acc}</P>, children)

// STEP 3: Add our hooks back in appropriate places
// (use git show HEAD:packages/app/src/app.tsx to see our version)
```

### Pattern 2: Export Additions

**Context:** Upstream added new exports, we also added exports.

**Resolution Strategy:**
```typescript
// CONFLICT in packages/app/src/index.ts

// STEP 1: Accept all upstream exports
git checkout --theirs packages/app/src/index.ts

// STEP 2: Add our additional exports at the end
export { useTerminal, TerminalProvider } from "./context/terminal"
export { ClaxedoThing } from "./claxedo-specific"  // if any
```

### Pattern 3: Context Provider Modifications

**Context:** Upstream modified a context we override.

**Resolution Strategy:**
```typescript
// CONFLICT in packages/app/src/context/terminal.tsx

// STEP 1: Note the upstream changes
// STEP 2: Apply those changes to OUR override in packages/claxedo-app/src/overrides/context/terminal.tsx
// STEP 3: Accept upstream version for the original file
git checkout --theirs packages/app/src/context/terminal.tsx

// STEP 4: Update our override to incorporate upstream changes
// (Check git show upstream/dev:packages/app/src/context/terminal.tsx)
```

### Pattern 4: Extension Point Additions

**Context:** Upstream added new functionality that should be exposed as extension points.

**Resolution Strategy:**
1. Accept upstream changes
2. Add extension point to `packages/app-shared/src/extension-points.ts`
3. Wire extension point into upstream file
4. Document in CLAXEDO_UPSTREAM_SYNC.md

---

## Manual 3-Way Merge Process

When "Merge carefully" is required:

### Step 1: Understand Both Versions

```bash
# See our version
git show HEAD:packages/app/src/app.tsx > /tmp/ours.tsx

# See upstream version
git show upstream/dev:packages/app/src/app.tsx > /tmp/theirs.tsx

# See common ancestor
git show $(git merge-base HEAD upstream/dev):packages/app/src/app.tsx > /tmp/base.tsx

# Compare
diff -u /tmp/base.tsx /tmp/theirs.tsx  # What upstream changed
diff -u /tmp/base.tsx /tmp/ours.tsx    # What we changed
```

### Step 2: Identify Overlapping Changes

- If upstream refactored a function we modified → **ESCALATE**
- If upstream added code near our hooks → **Merge carefully**
- If changes are in different sections → **Apply both**

### Step 3: Resolve and Mark

```bash
# After manual editing
git add packages/app/src/app.tsx
git rebase --continue
```

---

## Upstream Drift Review (Critical)

**After the rebase completes but BEFORE validation**, review upstream changes to catch silent breakage that doesn't produce merge conflicts. Conflicts only surface when both sides modify the same lines — but upstream can break our code by changing APIs, adding/removing exports, restructuring files, or adding dependencies that we never touch in our commits.

### Why This Step Exists

Real examples from past rebases:
- Upstream extracted inline components from `layout.tsx` into `./layout/*.tsx` files. Our modified `layout.tsx` kept the inline versions but was missing the new imports (`Switch`, `Match`, `Spinner`, `HoverCard`, `Collapsible`, `MessageNav`) that upstream's extracted files import separately — **no conflict**, just broken code.
- Upstream added `focusInput` to a function signature in `session.tsx`. Our override calls that function but didn't pass the new param — **no conflict**, just a type error.
- Upstream changed `LocalPTY` from an exported type to a local one, then re-exported it differently. Our override imported it but didn't re-export — **no conflict**, downstream code broke silently.
- Upstream added `@tauri-apps/plugin-clipboard-manager` to `desktop/package.json`. Our commit modified the same `package.json` for other reasons but the dep wasn't in our version — **no conflict** because different lines.
- Upstream added `flushResize()` to an interface. Our code implements that interface in a different file — **no conflict**, just a missing method.

### What To Review

#### 1. Diff upstream changes against files we override or modify

```bash
# List files changed in upstream since last sync
git diff <previous-upstream-commit>..upstream/dev --name-only

# Cross-reference with our overrides
ls packages/claxedo-app/src/overrides/

# For each upstream file that has a corresponding override, review what changed:
git diff <previous-upstream-commit>..upstream/dev -- packages/app/src/context/terminal.tsx
git diff <previous-upstream-commit>..upstream/dev -- packages/app/src/pages/session.tsx
# ... etc.
```

**Key question:** Did upstream change any API surface (exports, function signatures, interfaces, types) that our overrides or extension code depends on?

#### 2. Check for new/removed exports in upstream modules we import from

```bash
# Find all upstream modules our code imports
grep -rh "from ['\"]@/" packages/claxedo-app/src/ | sort -u

# For each critical module, compare exports
git show <previous-upstream-commit>:packages/app/src/context/terminal.tsx | grep "^export"
git show upstream/dev:packages/app/src/context/terminal.tsx | grep "^export"
```

**Key question:** Did any type/function we import get renamed, removed, or have its signature changed?

#### 3. Check upstream dependency changes

```bash
# Compare package.json files we also modify
diff <(git show <previous-upstream-commit>:packages/desktop/package.json) \
     <(git show upstream/dev:packages/desktop/package.json)

diff <(git show <previous-upstream-commit>:packages/app/package.json) \
     <(git show upstream/dev:packages/app/package.json)
```

**Key question:** Did upstream add dependencies that our version of the same `package.json` is now missing?

#### 4. Look for structural changes (file moves, extractions, renames)

```bash
# Files added or removed upstream
git diff <previous-upstream-commit>..upstream/dev --diff-filter=AD --name-only

# Check if any of these overlap with code we reference
```

**Key question:** Did upstream extract code into new files, or delete files we reference?

#### 5. Review upstream interface/type changes in files we implement

```bash
# Check types.ts, interfaces, and shared contracts
git diff <previous-upstream-commit>..upstream/dev -- "*.ts" | grep -A5 -B5 "interface\|type.*=\|export.*type"
```

**Key question:** Did upstream add required properties to interfaces our code implements?

### Resolution Pattern

For each drift issue found:

1. **Missing import/export** → Add the import/export to our file
2. **Changed function signature** → Update our call sites to match
3. **New required interface property** → Implement the property (no-op if not applicable)
4. **Missing dependency** → Add to our `package.json`
5. **Structural change** → Update our imports/references to match new file locations

Commit all drift fixes as a single commit: `fix: resolve upstream drift after YYYY-MM-DD rebase`

---

## Validation After Rebase

After resolving all conflicts and reviewing upstream drift:

### Step 1: Install Dependencies

```bash
bun install
```

### Step 2: Type Check

```bash
bun run typecheck
```

### Step 3: Run Tests

```bash
bun test
```

### Step 4: Build Check

```bash
# For web
bun run --cwd packages/claxedo-app build

# For opencode core
bun run --cwd packages/opencode build
```

### Step 5: Verify Extension System

```bash
# Check that extension points are still wired correctly
grep -r "getExtensions()" packages/app/src/ | head -10

# Verify overrides are in place
ls -la packages/claxedo-app/src/overrides/
```

---

## Documentation Updates

After successful rebase, update these files:

### 1. CLAXEDO_UPSTREAM_SYNC.md

Update the version compatibility table:

```markdown
| Claxedo Version | Upstream Commit | Last Sync Date |
|-----------------|-----------------|----------------|
| dev | $(git rev-parse --short upstream/dev) | $(date +%Y-%m-%d) |
```

### 2. SYNC_LOG.md (Create if doesn't exist)

Add entry for this sync:

```markdown
## $(date +%Y-%m-%d)

- **Sync Branch:** sync/$(date +%Y-%m-%d)
- **Upstream Commit:** $(git rev-parse --short upstream/dev)
- **Status:** Success/Partial/Failed
- **Conflicts Resolved:**
  - File X: Strategy used
  - File Y: Strategy used
- **New Modifications:** (if any)
- **Notes:** Any issues or observations
```

### 3. If New Files Modified

Add to "Upstream Modifications Registry" in CLAXEDO_UPSTREAM_SYNC.md with appropriate merge strategy.

---

## Red Flags (Escalate to Human)

**STOP and request human review if:**

1. **Upstream added their own plugin/extension system**
   - May conflict with our extension system
   - Requires architectural decision

2. **Upsteam refactored core context architecture**
   - Changes to Provider hierarchy
   - New context patterns

3. **Function signatures we depend on changed**
   - Extension points may need updates
   - Could break claxedo-app

4. **Major dependency version changes**
   - Breaking changes in core deps (SolidJS, Vite, etc.)
   - Requires testing

5. **Conflicts in >5 files simultaneously**
   - May indicate upstream refactoring
   - Batch resolution risky

6. **Unclear conflict origin**
   - Can't determine why file was modified
   - May be accidental change

7. **Build fails after resolution**
   - Type errors
   - Runtime errors in dev server

8. **Upstream restructured files we override or depend on**
   - Components extracted into new files
   - Modules split or merged
   - These won't cause conflicts but WILL cause silent breakage
   - The Upstream Drift Review section catches these

---

## Quick Reference

### Git Commands

```bash
# Check rebase progress
git status
git diff --name-only --diff-filter=U

# See conflict details
git diff

# Abort rebase (if stuck)
git rebase --abort

# Skip current commit
git rebase --skip

# Continue after resolution
git rebase --continue
```

### Conflict Resolution Shortcuts

```bash
# Keep our version
git checkout --ours <file>
git add <file>

# Keep upstream version
git checkout --theirs <file>
git add <file>

# Mark resolved manually
git add <file>
```

### Key Files to Monitor

- `packages/app-shared/src/extension-points.ts` - Extension API
- `packages/app/src/app.tsx` - Extension integration
- `packages/app/src/context/*.tsx` - Context providers
- `packages/claxedo-app/src/overrides/**` - Our overrides

---

## Related Documentation

- [CLAXEDO_UPSTREAM_SYNC.md](./packages/claxedo-app/.dev-docs/CLAXEDO_UPSTREAM_SYNC.md) - Detailed sync guide
- [ARCHITECTURE.md](./packages/claxedo-app/ARCHITECTURE.md) - System architecture
- [AGENTS.md](./AGENTS.md) - General coding guidelines
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines

---

*This document is maintained by the Rebase Agent. Last updated: 2026-02-07*
