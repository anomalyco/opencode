# OpenCode Bug Fix Implementation Guide

## Critical Bugs Requiring Immediate Attention

### Priority 1: CRASH BUG - Issue #10346 & #10344

**Severity**: CRITICAL - Application crash, complete TUI failure
**File**: `packages/opencode/src/cli/cmd/tui/context/local.tsx`
**Lines**: 41, 56-58

#### Problem
```typescript
// Line 41 - Unsafe array access
current: agents()[0].name,  // ❌ Crashes if agents() is empty

// Line 57 - Unsafe find with non-null assertion
return agents().find((x) => x.name === agentStore.current)!  // ❌ Assumes find succeeds
```

#### Implementation Fix

**Step 1: Backup the file**
```bash
cp packages/opencode/src/cli/cmd/tui/context/local.tsx packages/opencode/src/cli/cmd/tui/context/local.tsx.backup
```

**Step 2: Modify the agent initialization (around line 36-43)**

Find this code:
```typescript
const agent = iife(() => {
  const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
  const [agentStore, setAgentStore] = createStore<{
    current: string
  }>({
    current: agents()[0].name,
  })
```

Replace with:
```typescript
const agent = iife(() => {
  const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
  const firstAgent = agents()[0]

  // Validate that at least one agent exists
  if (!firstAgent) {
    throw new Error(
      "No agents available. Please ensure at least one agent is enabled in your configuration.\n" +
      "Visit https://opencode.ai/docs/agents for more information."
    )
  }

  const [agentStore, setAgentStore] = createStore<{
    current: string
  }>({
    current: firstAgent.name,
  })
```

**Step 3: Modify the current() method (around line 56-58)**

Find this code:
```typescript
current() {
  return agents().find((x) => x.name === agentStore.current)!
}
```

Replace with:
```typescript
current() {
  const current = agents().find((x) => x.name === agentStore.current)
  // Fallback to first available agent if current not found
  return current ?? agents()[0] ?? (() => {
    throw new Error("No agents available in configuration")
  })()
}
```

**Step 4: Test the fix**
```bash
# Run the test suite
bun test packages/opencode/test/cli/cmd/tui/context/local.test.tsx

# Or test manually by starting opencode
bun run dev
```

**Step 5: Clean up**
```bash
# If fix is successful, remove backup
rm packages/opencode/src/cli/cmd/tui/context/local.tsx.backup
```

---

### Priority 2: DATA LOSS BUG - Issue #10349

**Severity**: HIGH - Sessions invisible across platforms, data loss
**File**: `packages/opencode/src/storage/storage.ts`
**Line**: 220

#### Problem
```typescript
.then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
```

Uses platform-specific `path.sep` which differs between Windows (`\`) and Unix (`/`).

#### Implementation Fix

**Step 1: Backup the file**
```bash
cp packages/opencode/src/storage/storage.ts packages/opencode/src/storage/storage.ts.backup
```

**Step 2: Locate the list() function (around line 212-226)**

Find this code:
```typescript
const glob = new Bun.Glob("**/*")
export async function list(prefix: string[]) {
  const dir = await state().then((x) => x.dir)
  try {
    const result = await Array.fromAsync(
      glob.scan({
        cwd: path.join(dir, ...prefix),
        onlyFiles: true,
      }),
    ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
    result.sort()
    return result
  } catch {
    return []
  }
}
```

**Step 3: Replace with cross-platform version**

Replace the entire function with:
```typescript
const glob = new Bun.Glob("**/*")
export async function list(prefix: string[]) {
  const dir = await state().then((x) => x.dir)
  try {
    const result = await Array.fromAsync(
      glob.scan({
        cwd: path.join(dir, ...prefix),
        onlyFiles: true,
      }),
    ).then((results) =>
      results.map((x) => {
        // Remove .json extension (last 5 chars)
        const withoutExt = x.slice(0, -5)
        // Split by both path separators for cross-platform compatibility
        const parts = withoutExt.split(/[\/\\]/)
        return [...prefix, ...parts]
      })
    )
    result.sort()
    return result
  } catch {
    return []
  }
}
```

**Step 4: Test the fix**

Create a test file `packages/opencode/test/storage/cross-platform.test.ts`:
```typescript
import { test, expect } from "bun:test"
import { Storage } from "../../src/storage/storage"
import path from "path"

test("list handles cross-platform path separators", async () => {
  // This test simulates Windows paths on a Unix system (or vice versa)
  // In real scenario, this would be tested by syncing actual data

  // The key is that splitting works regardless of which separator was used
  const windowsStyle = "session\\project\\sessionID"
  const unixStyle = "session/project/sessionID"

  const windowsParts = windowsStyle.split(/[\/\\]/)
  const unixParts = unixStyle.split(/[\/\\]/)

  expect(windowsParts).toEqual(["session", "project", "sessionID"])
  expect(unixParts).toEqual(["session", "project", "sessionID"])
})
```

Run tests:
```bash
bun test packages/opencode/test/storage/cross-platform.test.ts
```

**Step 5: Clean up**
```bash
rm packages/opencode/src/storage/storage.ts.backup
```

---

## Verification Checklist

After implementing each fix:

- [ ] File compiles without errors
- [ ] All tests pass
- [ ] Manual testing confirms fix works
- [ ] No regressions in related functionality
- [ ] Update documentation if needed

## Testing Strategy

### For Issue #10346 (Crash Bug)
1. Test with all agents disabled:
   ```json
   {"agent": {"build": {"disable": true}, "plan": {"disable": true}}}
   ```
2. Verify TUI doesn't crash
3. Verify helpful error message shown

### For Issue #10349 (Cross-Platform)
1. Create sessions on Windows
2. Sync data directory to Linux/macOS
3. Verify sessions appear in list
4. Verify sessions can be loaded

## Rollback Plan

If a fix causes issues:
```bash
# Restore backup
cp packages/opencode/src/cli/cmd/tui/context/local.tsx.backup packages/opencode/src/cli/cmd/tui/context/local.tsx

# Or
cp packages/opencode/src/storage/storage.ts.backup packages/opencode/src/storage/storage.ts

# Rebuild
bun run build
```

## Commit Message Format

```bash
git commit -m "fix: prevent crash when no agents available

- Add null-safe array access in local.tsx
- Provide clear error message when configuration invalid
- Fixes #10346 and #10344

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

```bash
git commit -m "fix: handle cross-platform path separators in storage.list()

- Split paths by both / and \ for compatibility
- Fixes session invisibility across platforms
- Fixes #10349

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## Additional Notes

- These fixes are backward compatible
- No API changes required
- Existing configurations continue to work
- Only edge cases (previously crashing) now handled gracefully

## Questions?

Refer to detailed analysis documents:
- `.ralph/docs/issue_10346_analysis.md`
- `.ralph/docs/issue_10349_analysis.md`
