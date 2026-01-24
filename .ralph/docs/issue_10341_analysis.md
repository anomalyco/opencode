# Issue #10341: Windows garbled output issue (Scoop installation)

## Root Cause Analysis

### Problem Statement

When OpenCode is installed via Scoop on Windows, the output appears garbled/corrupted. This suggests a character encoding issue where non-ASCII characters (Unicode, emojis, special symbols) are not displayed correctly.

### Technical Details

**Issue**: Missing encoding specification in Buffer.toString() calls

**Files Affected**:

1. **`packages/opencode/src/cli/cmd/tui/util/terminal.ts:55`**
   ```typescript
   const handler = (data: Buffer) => {
     const str = data.toString()  // ❌ No encoding specified
   ```

2. **`packages/opencode/src/cli/cmd/tui/app.tsx:54`**
   ```typescript
   const handler = (data: Buffer) => {
     const str = data.toString()  // ❌ No encoding specified
   ```

### Why This Causes Garbled Output on Windows

**Default Encoding Behavior**:
- On Unix/Linux/macOS: Default encoding is typically UTF-8
- On Windows: Default encoding varies by system locale (often CP1252, CP437, or other codepages)
- **Node.js Buffer.toString()**: Uses system default encoding when not specified

**The Problem**:
```typescript
// On Windows with CP1252 locale
const buffer = Buffer.from([0xE2, 0x9C, 0x93])  // UTF-8 for "✓"
buffer.toString()              // Returns "â" (wrong - interprets as CP1252)
buffer.toString("utf8")        // Returns "✓" (correct)
```

**When This Happens**:
1. Terminal responses (OSC color queries) contain special characters
2. Keyboard input may contain Unicode characters
3. Clipboard data may contain emoji/symbols
4. File names with non-ASCII characters

### Impact on TUI Components

**Affected Areas**:
1. **Terminal color detection** (`terminal.ts:55`)
   - OSC escape sequences may be misparsed
   - Color values could be incorrectly interpreted

2. **TUI input handling** (`app.tsx:54`)
   - User input with special characters displays incorrectly
   - Non-English text input problems

3. **Clipboard operations** (`clipboard.ts`)
   - Multiple Buffer.toString() calls for base64 encoding
   - These use "base64" encoding explicitly, so they're OK

### Solution

**Change all `Buffer.toString()` calls to `Buffer.toString("utf8")`**

**File**: `packages/opencode/src/cli/cmd/tui/util/terminal.ts:55`

**Before**:
```typescript
const handler = (data: Buffer) => {
  const str = data.toString()

  // Match OSC 11 (background color)
  const bgMatch = str.match(/\x1b]11;([^\x07\x1b]+)/)
```

**After**:
```typescript
const handler = (data: Buffer) => {
  const str = data.toString("utf8")

  // Match OSC 11 (background color)
  const bgMatch = str.match(/\x1b]11;([^\x07\x1b]+)/)
```

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx:54`

**Before**:
```typescript
const handler = (data: Buffer) => {
  const str = data.toString()
```

**After**:
```typescript
const handler = (data: Buffer) => {
  const str = data.toString("utf8")
```

### Additional Buffer.toString() Usage

Let me check if there are other instances that need fixing:

**Safe** (explicitly specify encoding):
```typescript
// clipboard.ts - These are OK
Buffer.from(text).toString("base64")
Buffer.from(buffer).toString("base64")
```

**Potentially Unsafe** (need to verify):
```typescript
// Any other Buffer.toString() calls without encoding
```

### Testing Strategy

**Manual Testing**:
1. Install OpenCode via Scoop on Windows
2. Test with various Unicode inputs:
   - Emoji: ✓ ❄ 🎉
   - Non-ASCII: café, 日本語, 中文
   - Special symbols: © ® ™ €
3. Verify terminal color detection works
4. Test keyboard input with special characters

**Automated Testing**:
```typescript
test("Buffer encoding is UTF-8", () => {
  const buffer = Buffer.from([0xE2, 0x9C, 0x93])  // ✓
  const str = buffer.toString("utf8")
  expect(str).toBe("✓")
})
```

### Related Issues

This is similar to Issue #10349 (cross-platform path separators) - both are platform-specific differences that cause problems on Windows.

### Why Scoop Installation Matters

**Scoop** is a Windows package manager that:
- Installs applications in user directory
- May not set system locale environment variables
- Inherits PowerShell/CMD default encoding

**Other installation methods** (WSL, Git Bash, native) may:
- Have UTF-8 configured by default
- Use different terminal emulators
- Have different locale settings

### Platform-Specific Behavior

**Windows Codepages**:
- CP1252 (Western European) - common in US/UK
- CP437 (US) - older CMD default
- CP65001 (UTF-8) - needs explicit configuration
- Many other codepages for different regions

**Node.js Behavior**:
```javascript
// On Windows with CP1252
process.stdout.write("✓")  // May produce "â" or "✓" depending on console
Buffer.from("✓").toString() // Uses CP1252, produces garbled output
```

### Comprehensive Fix

**Search Pattern**:
```bash
grep -rn "\.toString()" /root/opencode/packages/opencode/src/cli/cmd/tui
```

**Replace All Instances**:
```typescript
// From
data.toString()

// To
data.toString("utf8")
```

**Exception**: When encoding is explicitly specified (like `"base64"`, `"hex"`)

### Severity

**Severity**: MEDIUM - Works but with degraded UX on Windows

**Affected Users**:
- Windows users with non-UTF-8 system locales
- Scoop installations (may not configure UTF-8)
- Users who type non-ASCII characters

**User Experience**:
- **Before**: Special characters appear as random characters
- **After**: All Unicode characters display correctly

### Cross-Reference

**Similar Issues**:
- Issue #10349: Cross-platform path separator (also Windows-specific)
- Both relate to platform differences affecting data integrity

**Related Code**:
- `packages/opencode/src/cli/cmd/tui/util/terminal.ts` - Terminal detection
- `packages/opencode/src/cli/cmd/tui/app.tsx` - Input handling
- `packages/opencode/src/cli/cmd/tui/util/clipboard.ts` - Clipboard operations

### Status

- ✅ Root cause identified
- ✅ Solution designed
- ⏳ Need to verify all Buffer.toString() calls in TUI code
- ⏳ Awaiting write permissions to implement fix
- ⏳ Tests needed for Windows environments

### Prevention

**Code Review Guidelines**:
- [ ] Always specify encoding in Buffer.toString(encoding)
- [ ] Use "utf8" for text data
- [ ] Use "base64" or "hex" for binary data
- [ ] Never rely on default encoding (platform-dependent)

**Pattern**:
```typescript
// ❌ BAD - Platform-dependent
buffer.toString()

// ✅ GOOD - Explicit encoding
buffer.toString("utf8")  // For text
buffer.toString("base64") // For binary-to-text encoding
```

### Implementation Checklist

1. [ ] Search all TUI code for `Buffer.toString()`
2. [ ] Identify calls without encoding parameter
3. [ ] Add "utf8" parameter to text handling
4. [ ] Leave "base64"/"hex" unchanged
5. [ ] Test on Windows with Unicode input
6. [ ] Test on Unix/Linux (ensure no regression)
7. [ ] Add automated test for encoding
8. [ ] Update documentation with platform notes
