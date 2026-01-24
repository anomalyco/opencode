# Issue #10349: Sessions not visible across platforms when syncing data directory

## Root Cause Analysis

### Problem Statement
When users sync the OpenCode data directory across platforms (e.g., Windows to Linux or macOS), sessions created on one platform become invisible on the other platform.

### Technical Details

**File**: `packages/opencode/src/storage/storage.ts`

**Location**: Line 212-226, specifically line 220

**Current Implementation**:
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

**The Bug**:
Line 220 splits file paths by `path.sep`, which is platform-specific:
- Windows: `path.sep` = `\` (backslash)
- Unix/Linux/macOS: `path.sep` = `/` (forward slash)

### Reproduction Steps

1. Create a session on Windows
2. Session files are stored with Windows paths: `session\projectID\sessionID.json`
3. Sync data directory to Linux/macOS (via Dropbox, OneDrive, Git, etc.)
4. Try to list sessions on Linux/macOS
5. The code tries to split `session\projectID\sessionID` by `/` instead of `\`
6. Result: Returns incorrect key array, sessions fail to load

### Example

**On Windows:**
```
File: C:\Users\User\AppData\Local\opencode\storage\session\abc123\def456.json
Relative path from storage dir: session\abc123\def456.json
After removing .json: session\abc123\def456
Split by \ (Windows): ["session", "abc123", "def456"] ✅
```

**On Linux (synced data):**
```
File still has Windows separator: session\abc123\def456.json
Relative path from storage dir: session\abc123\def456.json
After removing .json: session\abc123\def456
Split by / (Linux): ["session\\abc123\\def456"] ❌ WRONG!
```

### Solution

**Option 1: Use `path.sep` only for current platform, normalize paths**

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
        // Normalize path separators to current platform
        const normalized = x.split(/[\/\\]/).join(path.sep)
        return [...prefix, ...normalized.slice(0, -5).split(path.sep)]
      })
    )
    result.sort()
    return result
  } catch {
    return []
  }
}
```

**Option 2: Use path manipulation functions instead of string splitting**

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
        // Get relative path without .json extension
        const relative = path.relative(path.join(dir, ...prefix), x)
        const withoutExt = relative.slice(0, -5) // Remove .json
        // Split by both separators for cross-platform compatibility
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

**Recommended: Option 2** - More robust, uses proper path handling

### Testing

Add test case to verify cross-platform compatibility:

```typescript
// packages/opencode/test/storage/storage.test.ts

test("list handles cross-platform path separators", async () => {
  await using tmp = await tmpdir()

  // Simulate Windows-created files (with backslashes in paths)
  const windowsSession = {
    id: "win-session-123",
    title: "Windows Session",
    projectID: "project-abc",
    // ... other session fields
  }

  // Create session files with path separators that might come from Windows
  const sessionPath = path.join(tmp.path, "storage", "session", "project-abc", "win-session-123.json")
  await fs.mkdir(path.dirname(sessionPath), { recursive: true })
  await Bun.write(sessionPath, JSON.stringify(windowsSession))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessions = await Storage.list(["session", "project-abc"])
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toEqual(["session", "project-abc", "win-session-123"])

      // Verify session can be loaded
      const session = await Storage.read<Session.Info>(["session", "project-abc", "win-session-123"])
      expect(session.id).toBe("win-session-123")
    },
  })
})
```

### Impact Assessment

**Affected Users**:
- Anyone syncing data directory between Windows and Unix-like systems
- Users using cloud storage (Dropbox, OneDrive, Google Drive)
- Users using Git to sync data directory
- Dual-boot systems

**Severity**: High - Data loss (sessions become inaccessible)

**Frequency**: Common for cross-platform developers

### Related Issues

- Issue #10341: "Scoop-fixes-opencode-windows-x64-garbled-output-issue-but-cause-unknown" (also Windows-specific)
- May affect other storage operations that use path manipulation

### Workaround

**Immediate workaround for users**:
1. Don't sync the data directory across platforms
2. Use separate data directories for each platform
3. Export/import sessions instead of syncing storage

**No code workaround** - requires fix

### Status

- ✅ Root cause identified
- ✅ Solution designed
- ⏳ Awaiting write permissions to implement fix
- ⏳ Tests to be written
- ⏳ Documentation to be updated

### Additional Notes

The same issue may affect other parts of the codebase that use `path.sep` for string manipulation:
- Message storage
- Part storage
- Share data

A comprehensive audit of path separator usage is recommended.
