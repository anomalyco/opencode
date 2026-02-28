# Fix for Issue #15482: Symlink Path Resolution

## Problem

When OpenCode was started from a directory that was a symlink, it would create two separate server instances:
- One for the symlink path (e.g., `/home/user/ssd/project`)
- One for the resolved real path (e.g., `/media/user/ssd_storage/project`)

This caused the TUI to freeze when sending prompts because the UI was connected to one instance while session operations were executing on a different instance.

## Root Cause

The `Instance.provide()` function in `packages/opencode/src/project/instance.ts` used the raw input directory path as the cache key without resolving symlinks first. This meant:

1. User opens OpenCode with `opencode ~/ssd/project` (symlink path)
2. Instance created with cache key: `/home/user/ssd/project`
3. Sessions created and stored with this directory
4. Later operations (git commands, etc.) might resolve to real path: `/media/user/ssd_storage/project`
5. When switching sessions, a second instance gets created with the real path
6. TUI remains connected to first instance, but operations happen on second instance
7. Messages never reach the UI → freeze

Evidence from logs showed both instances being disposed:
```
service=default directory=/media/user/ssd_storage/project disposing instance
service=default directory=/home/user/ssd/project disposing instance
```

## Visual Explanation

### Before the fix:
```
User runs: opencode ~/ssd/project
                    ↓
         ~/ssd → /media/user/ssd_storage
                    ↓
    Instance.provide({ directory: "~/ssd/project" })
                    ↓
         cache["~/ssd/project"] = Instance #1  ← TUI connected here
                    ↓
    Session created with directory: "~/ssd/project"
                    ↓
    (Later, when switching sessions...)
                    ↓
    Instance.provide({ directory: "/media/user/ssd_storage/project" })
                    ↓
         cache["/media/user/ssd_storage/project"] = Instance #2  ← Operations happen here
                    ↓
              TUI FREEZE! 
    (UI listening to Instance #1, but messages going to Instance #2)
```

### After the fix:
```
User runs: opencode ~/ssd/project
                    ↓
         canonical("~/ssd/project")
                    ↓
         resolves symlinks
                    ↓
         "/media/user/ssd_storage/project"
                    ↓
    cache["/media/user/ssd_storage/project"] = Instance #1
                    ↓
    (Later, when switching sessions...)
                    ↓
         canonical("/media/user/ssd_storage/project")
                    ↓
         "/media/user/ssd_storage/project"
                    ↓
    Uses same Instance #1 ✓
```

## Solution

Added symlink resolution in `Instance.provide()` before using the directory as a cache key:

```typescript
async function canonical(input: string) {
  const abs = path.resolve(input)
  const real = await fs.realpath(abs).catch(() => abs)
  const normalized = path.normalize(real)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}
```

This function:
1. Resolves to absolute path
2. Resolves symlinks using `fs.realpath()`
3. Normalizes path separators
4. Lowercases on Windows for case-insensitive matching

The normalized directory is now used consistently as:
- The cache key for instance lookup
- The stored value in `Instance.directory`
- The directory passed to `Project.fromDirectory()`

## Testing

Added comprehensive tests in `packages/opencode/test/project/instance-symlink.test.ts`:

1. **Same instance for symlink and real path**: Verifies that accessing via symlink or real path uses the same instance
2. **No duplicate instances when switching sessions**: Simulates the original bug scenario

Both tests pass, confirming the fix works correctly.

## Impact

- Symlink and real paths now resolve to the same instance
- Session switching works correctly regardless of path representation
- No more TUI freezing when working with symlinked directories
- All existing tests continue to pass

## Files Changed

- `packages/opencode/src/project/instance.ts` - Added `canonical()` function and path normalization
- `packages/opencode/test/project/instance-symlink.test.ts` - New test file with regression tests
- `packages/opencode/test/project/SYMLINK_FIX.md` - Technical documentation

## Related

- GitHub Issue: https://github.com/anomalyco/opencode/issues/15482
- Reported by: snowstorm0182
- OpenCode version affected: 1.2.15