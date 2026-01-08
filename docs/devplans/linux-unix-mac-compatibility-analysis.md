# Linux/Unix/Mac Compatibility Analysis - Fork Comparison Report

## Executive Summary

**Status: POTENTIAL REGRESSION DETECTED**

This fork was created to fix Git Bash command execution issues on Windows, but the changes may have inadvertently modified behavior for Linux/Unix/Mac users.

---

## Key Finding: Shell Bypass Logic Changed

### Original Behavior (Upstream)
- PowerShell commands: `shouldBypassShell = true` (direct execution)
- CMD commands: `shouldBypassShell = true` (direct execution)
- Bash commands: `shouldBypassShell = false` (shell wrapper)

### Current Fork Behavior
- PowerShell commands: `shouldBypassShell = false` (shell wrapper) - **CHANGED!**
- CMD commands: `shouldBypassShell = true` (direct execution) - same
- Bash commands: `shouldBypassShell = false` (shell wrapper) - same

---

## Code Changes Summary

### Files Modified
1. [`packages/opencode/src/tool/bash.ts`](packages/opencode/src/tool/bash.ts:133-168)
   - Added `detectCommandShell()` function (lines 108-127)
   - Added `parseCommand()` function (lines 133-169)
   - Modified execution logic (lines 280-294)

2. [`packages/opencode/test/tool/bash.test.ts`](packages/opencode/test/tool/bash.test.ts:42-90)
   - Tests expect `shouldBypassShell = true` for PowerShell
   - But implementation returns `false` → **TEST FAILING**

---

## Impact on Linux/Unix/Mac

### Potential Issues

| Scenario | Original | Current | Impact |
|----------|----------|---------|--------|
| PowerShell execution (via WSL/docker) | Direct exec | Shell wrapper | **Minor** - May affect WSL users |
| CMD command execution | Direct exec | Direct exec | ✅ No change |
| Bash command execution | Shell wrapper | Shell wrapper | ✅ No change |

### What Should Still Work
✅ `bash -c "echo hello"` - Standard bash commands  
✅ `ls -la`, `git status`, `npm install` - Regular Unix commands  
✅ `cmd /c echo test` - CMD commands on WSL  
✅ Shell built-ins (`cd`, `pwd`, `echo`) - All platforms  

### What Might Be Affected
⚠️ **PowerShell on Linux** - If PowerShell is installed on Linux systems, the shell wrapper change could affect how commands are parsed and executed. However, this is a rare edge case.

---

## Test Coverage Gap

### Issue #13: Inconsistent Test Expectations

The Unix test expects:
```typescript
// bash.test.ts:42-47
it("should bypass shell for powershell.exe commands", () => {
  const result = parseCommand("powershell.exe -Command Get-Process")
  expect(result.shouldBypassShell).toBe(true)  // ← Expects TRUE
})
```

But the implementation returns:
```typescript
// bash.ts:148
shouldBypassShell: false // Use shell wrapper for proper parsing
```

**This is a contradiction - the test expects bypass, but code returns no-bypass.**

---

## Recommendations

### 1. Fix the Test/Code Mismatch
Either:
- Update the test to expect `false` (matching current implementation), OR
- Update the implementation to return `true` (matching original intent)

### 2. Verify Linux/Unix/Mac Behavior
Run these commands on a Linux/Mac system:
```bash
# Test bash commands
bash -c "echo 'Hello from bash'"

# Test git commands
git status

# Test npm commands
npm --version
```

### 3. Check WSL PowerShell (if applicable)
```bash
# On Windows with WSL
pwsh -Command "Get-Process"
```

---

## Comparison with Upstream

### Upstream bash.ts (original behavior)
```typescript
// parseCommand for PowerShell
if (shellType === 'powershell' || shellType === 'pwsh') {
  return {
    executable,
    args,
    shouldBypassShell: true  // Direct execution
  }
}
```

### This Fork bash.ts (current behavior)
```typescript
// parseCommand for PowerShell
if (shellType === 'powershell' || shellType === 'pwsh') {
  return {
    executable,
    args,
    shouldBypassShell: false  // Shell wrapper
  }
}
```

---

## Conclusion

**Linux/Unix/Mac users should NOT be affected** by this fork's changes, because:

1. The shell detection logic only triggers on Windows (`process.platform === "win32"`)
2. Linux/Mac systems will continue to use their native shells
3. The `shouldBypassShell` change only affects PowerShell/CMD on Windows

**However, there's a test failure** in `bash.test.ts` that indicates a code/test mismatch. This doesn't affect runtime behavior but indicates the tests need updating to match the new implementation.

---

## Next Steps

1. ✅ **Verify** - Test bash commands on Linux/Mac
2. 🔧 **Fix** - Resolve the test/code mismatch in `bash.test.ts`
3. 📝 **Document** - Add note about PowerShell shell wrapper change
4. 🧪 **Test** - Run full test suite to confirm no regressions

---

**Report Generated:** January 8, 2026  
**Repository:** burgercrisis/opencode (fork of anomalyco/opencode)  
**Branch:** Git-Bash-Fork-Fix
