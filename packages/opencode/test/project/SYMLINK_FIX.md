# Symlink Path Resolution Fix

## Issue

When OpenCode was opened from a directory that was a symlink to another path, it would create two separate server instances:

1. One instance for the symlink path (e.g., `/home/user/ssd/project`)
2. Another instance for the resolved real path (e.g., `/media/user/ssd_storage/project`)

This caused the TUI to freeze when sending prompts because:
- The TUI event stream was connected to one instance
- But session operations were executing on a different instance
- Messages would never reach the UI since they were going to the wrong instance

## Root Cause

The `Instance.provide()` function used the raw input directory as the cache key without resolving symlinks first. This meant:

1. User opens OpenCode with `opencode ~/ssd/project` (symlink path)
2. Instance created with key: `/home/user/ssd/project`
3. Session created and stored with `Instance.directory` (symlink path)
4. Later, git commands or other operations resolve to real path: `/media/user/ssd_storage/project`
5. When switching sessions, the stored directory might differ from cwd
6. Second instance created with key: `/media/user/ssd_storage/project`
7. TUI connected to first instance, but operations happening on second instance

## Solution

Added a `canonical()` function in `instance.ts` that resolves symlinks using `fs.realpath()` before using the directory as a cache key. This ensures:

- Symlink paths and their real paths map to the same instance
- Only one server instance is created per physical directory
- Session switching works correctly even when paths contain symlinks
- All operations happen on the same instance the TUI is connected to

## Implementation

```typescript
async function canonical(input: string) {
  const abs = path.resolve(input)
  const real = await fs.realpath(abs).catch(() => abs)
  const normalized = path.normalize(real)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}
```

This function:
1. Resolves the path to an absolute path
2. Resolves any symlinks to the real path using `fs.realpath()`
3. Normalizes the path (handles platform differences)
4. On Windows, lowercases for case-insensitive matching

The normalized directory is then used consistently as both:
- The cache key for instance lookup
- The stored value in `Instance.directory`

## Testing

Two test cases were added in `instance-symlink.test.ts`:

1. **Same instance for symlink and real path**: Verifies that accessing a directory via symlink and via real path uses the same instance
2. **No duplicate instances when switching sessions**: Simulates the original bug scenario where switching sessions could create duplicate instances

## Related Issue

GitHub Issue: #15482