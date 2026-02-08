# Merge Conflict Resolution Reference

A quick reference for resolving common merge conflict patterns when syncing with upstream.

## Table of Contents

1. [Extension System Conflicts](#1-extension-system-conflicts)
2. [Context Provider Conflicts](#2-context-provider-conflicts)
3. [Package.json Conflicts](#3-packagejson-conflicts)
4. [Lockfile Conflicts](#4-lockfile-conflicts)
5. [New File Conflicts](#5-new-file-conflicts)
6. [TypeScript Type Conflicts](#6-typescript-type-conflicts)

---

## 1. Extension System Conflicts

### Pattern: Upstream modified `app.tsx`

**Our changes:** Added extension system integration (`getExtensions()`, `wrapProviders()`)

**Resolution:**

```bash
# 1. See what upstream changed
git show upstream/dev:packages/app/src/app.tsx > /tmp/upstream-app.tsx
git show HEAD:packages/app/src/app.tsx > /tmp/our-app.tsx

# 2. Accept upstream
git checkout --theirs packages/app/src/app.tsx

# 3. Re-apply our extension integration
# Look for these patterns and add them back:
# - import { getExtensions } from "@opencode-ai/app-shared"
# - const extensions = getExtensions()
# - wrapProviders() calls
# - Extension point checks

# 4. Add and continue
git add packages/app/src/app.tsx
git rebase --continue
```

**Common Code Patterns to Preserve:**

```typescript
// Import
import { getExtensions } from "@opencode-ai/app-shared"

// Provider wrapping
const extensions = getExtensions()
const wrapProviders = (providers: ParentComponent[], children: JSX.Element) =>
  providers.reduceRight((acc, P) => <P>{acc}</P>, children)

// In JSX
{wrapProviders(extensions.app.providers, <AppContent />)}

// Extension checks
if (extensions.app.layoutComponent) {
  const Layout = extensions.app.layoutComponent
  return <Layout>{children}</Layout>
}
```

---

## 2. Context Provider Conflicts

### Pattern: Upstream modified a context we override

**Files affected:** `packages/app/src/context/*.tsx`

**Resolution:**

```bash
# 1. Accept upstream changes to original file
git checkout --theirs packages/app/src/context/terminal.tsx
git add packages/app/src/context/terminal.tsx

# 2. Compare upstream changes with our override
git show upstream/dev:packages/app/src/context/terminal.tsx > /tmp/upstream-terminal.tsx
cat packages/claxedo-app/src/overrides/context/terminal.tsx > /tmp/our-override.tsx

# 3. Apply upstream changes to our override
diff -u /tmp/upstream-terminal.tsx /tmp/our-override.tsx

# 4. Update our override file with new upstream logic
# (but keep our extension hooks)
```

**Key Rule:** Context overrides in `claxedo-app` extend upstream. When upstream changes, we must update our override to incorporate those changes while preserving our additions.

---

## 3. Package.json Conflicts

### Pattern: Both modified dependencies

**Resolution:**

```bash
# 1. Don't use ours or theirs - manually merge
git checkout --merge packages/claxedo-app/package.json

# 2. Or edit manually to resolve conflicts
# Look for:
# <<<<<<< HEAD
# "dep": "^1.0.0"
# =======
# "dep": "^2.0.0"
# >>>>>>> upstream/dev

# 3. Resolution rules:
# - Keep our added dependencies
# - Accept upstream version bumps (usually higher)
# - If same package, different versions: use higher version
# - If conflicting peer dependencies: check compatibility

# 4. After resolution
git add packages/claxedo-app/package.json
```

**Decision Matrix:**

| Scenario | Resolution |
|----------|------------|
| We added dep, upstream didn't change | Keep ours |
| Upstream bumped version | Accept upstream (usually) |
| Both bumped to different versions | Use higher version |
| Upstream removed dep we use | Keep it (we need it) |
| Peer dependency conflict | Check compatibility, may need resolution |

---

## 4. Lockfile Conflicts

### Pattern: `bun.lock` has conflicts

**Resolution:**

```bash
# 1. Accept upstream lockfile
git checkout --theirs bun.lock
git add bun.lock

# 2. After rebase completes, regenerate
bun install

# 3. Commit updated lockfile separately if needed
git add bun.lock
git commit --amend --no-edit
```

**Never** try to manually merge lockfiles. Always regenerate after package.json changes.

---

## 5. New File Conflicts

### Pattern: Both added file with same name

**Resolution:**

```bash
# 1. Identify which package the file belongs to
# - If in claxedo-app/ or app-shared/: Keep ours
# - If in app/, opencode/, desktop/: Check if it's ours or upstream

# 2. If both packages added same file (rare)
# - Check if content is the same
# - If different, ours takes precedence in our packages
git checkout --ours path/to/file
git add path/to/file
```

---

## 6. TypeScript Type Conflicts

### Pattern: Type errors after resolution

**Common Issues:**

1. **Upstream changed interface, we implemented it**
   ```typescript
   // Upstream added required property
   interface Config {
     newProp: string  // This is new
   }
   
   // Our code
   const config: Config = { /* missing newProp */ }
   ```
   **Fix:** Add the new property or make it optional in our override.

2. **Function signature changed**
   ```typescript
   // Old
   function useThing(id: string): Thing
   
   // New
   function useThing(id: string, options?: Options): Thing
   ```
   **Fix:** Update our call sites if needed.

3. **Type exports changed**
   ```typescript
   // Check if types we import still exist
   import { SomeType } from "@opencode-ai/app-shared"
   ```

**Resolution Steps:**

```bash
# 1. Run type check to see errors
bun run typecheck

# 2. Fix errors in our code (claxedo-app/)
# Don't modify upstream files unless necessary

# 3. If upstream types broke our code:
# - Check if we can adapt to new types
# - If breaking change, may need extension point update
```

---

## Quick Decision Checklist

When encountering any conflict, ask:

1. [ ] Is this in `packages/claxedo-app/`? → **Keep ours**
2. [ ] Is this in `packages/app-shared/`? → **Keep ours**
3. [ ] Is this a lockfile? → **Accept upstream, regenerate**
4. [ ] Is this in the modifications registry? → **Follow registry strategy**
5. [ ] Is this a config file (package.json, tsconfig)? → **Manual merge**
6. [ ] Is this in the "Never Modify" list? → **Accept upstream**
7. [ ] Default → **Accept upstream, document deviation**

---

## Post-Resolution Checklist

After resolving all conflicts:

1. [ ] Run `bun install` to update dependencies
2. [ ] Run `bun run typecheck` to catch type errors
3. [ ] Run `bun test` to catch runtime issues
4. [ ] Build packages: `bun run --cwd packages/claxedo-app build`
5. [ ] Verify overrides are still working
6. [ ] Update SYNC_LOG.md
7. [ ] If new modifications found, update CLAXEDO_UPSTREAM_SYNC.md

---

## Emergency Procedures

### If rebase is stuck:

```bash
# Check status
git status
git diff --name-only --diff-filter=U

# See what's happening
git log --oneline -5

# Abort if needed
git rebase --abort
git checkout fork/dev
git branch -D sync/YYYY-MM-DD
```

### If validation fails after resolution:

```bash
# Type errors
bun run typecheck 2>&1 | head -50

# Check which files have errors
# If in our code: Fix them
# If in upstream: May need to adapt our code
```

---

*See REBASE_AGENT.md for full agent documentation.*
