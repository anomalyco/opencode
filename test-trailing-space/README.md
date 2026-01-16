# Test Setup for Issue #8937

## Directory with Trailing Space

The directory `TestProject ` (note the trailing space) has been created to test the fix for trailing spaces in directory names.

## How to Test

1. Navigate to the directory with trailing space:

   ```bash
   cd "TestProject "
   ```

2. Run opencode using the compiled binary:

   ```bash
   ../packages/opencode/dist/opencode-darwin-arm64/bin/opencode
   ```

   Or using the symlink:

   ```bash
   ../test-trailing-space/opencode
   ```

3. Expected behavior:
   - A warning should be displayed: `Warning: Path has trailing whitespace: "/path/to/TestProject "`
   - OpenCode should start normally (no hang)
   - Internal operations use sanitized path (trailing space removed)

## Important Note

The directory on disk still has the trailing space (`TestProject `). The fix:

- Warns you about the path issue
- Uses the sanitized path for internal operations (git commands, caching, etc.)
- Uses the actual path for `chdir()` since that's what exists on disk

**You should rename your directory** to remove the trailing space for a proper fix:

```bash
cd ..
mv "TestProject " "TestProject"
cd TestProject
```

## What was fixed

Before this fix:

- OpenCode would hang indefinitely when run from a directory with trailing spaces
- Git commands would fail silently or hang when passed a path with trailing spaces
- No error message or warning was shown

After this fix:

- Path sanitization detects trailing spaces
- User is warned about the path issue
- OpenCode continues normally with the sanitized path for internal operations
- Actual path with trailing space is only used for `chdir()`
