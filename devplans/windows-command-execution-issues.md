# Windows Command Execution - Comprehensive Issue Analysis
## Executive Summary
Complete investigation of Windows command execution issues across all related files. **37 issues identified** with confidence-sorted analysis.
**Status Update (January 8, 2026 18:56 UTC)**: 
- **CONFIRMED Issues (3)**: #10, #13, #7 - All bugs verified with test evidence (edit tool issues moved to verified-fixes-summary.md)
- **Partial Fix (1)**: #1 - CMD works, PowerShell still broken
- **Documented Behavior (2)**: #10, #13 - PowerShell inline execution is a KNOWN limitation with documented workarounds
- **✅ FIXED (0)**: No Windows command execution issues fixed
- **Unfixed Issues (23)**: #6, #11, #12, #14, #16, #17, #18, #20, #21, #22, #23, #24, #25, #27, #28, #29, #30, #31, #32, #33, #34, #35, #36, #37, #38, #39, #40, #42
- **New Issue (1)**: #42 - Python3 alias triggers Microsoft Store prompt on Windows
- **🔬 TESTED (January 8, 2026)**: Universal test prompt executed - ALL 3 OPEN ISSUES CONFIRMED
  - Issue #10: PowerShell inline - commands echo instead of execute (3/3 tests failed)
  - Issue #13: Test inconsistency - PowerShell fails, CMD works, -File workaround works
- **NOTE**: Issues #7, #15, #19, #26 (edit tool) have been moved to verified-fixes-summary.md for tracking
---

## Action Plan

### P0 (Critical - BUGS CONFIRMED WITH TEST EVIDENCE)


| Issue | Action | Status | Confidence |
|-------|--------|--------|------------|
| #10 | PowerShell inline execution - BUG CONFIRMED | ❌ UNFIXED | 100% |
| #13 | Test inconsistency - BUG CONFIRMED | ❌ UNFIXED | 100% |
### P0-Completed (Already Fixed - CMD Only)
| Issue | Action | Status | Confidence |
|-------|--------|--------|------------|
| #1 | Add shell bypass to bash.ts | ⚠️ PARTIAL | 100% (CMD) / 0% (PS) |
### P2 (High Priority - Command Execution)
| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #14 | Fix PowerShell -Command script blocks | High | 90% |
| #18 | Fix Windows path escaping | Medium | 85% |
| #25 | Add output verification | Medium | 80% |
| #27 | Implement file locking | Medium | 75% |
| #24 | Fix CMD double-escaping | Easy | 80% |
| #32 | Fix CMD quote/path handling | Medium | 65% |
### P3 (Medium Priority)
| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #16 | Improve error handling for exit codes | Low | 85% |
| #17 | Improve output truncation | Low | 85% |
| #21 | Add timeout handling to prompt.ts | Medium | 80% |
| #22 | Add timedOut metadata to prompt.ts | Easy | 80% |
| #23 | Use shell-quote for argument parsing | Medium | 80% |
| #20 | Adaptive timeout handling | Medium | 80% |
### P3 (Lower Priority / Edge Cases)
| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #28 | Add UNC path support | Medium | 75% |
| #29 | Improve fallback handling | Low | 75% |
| #30 | Handle variable expansion in patterns | Medium | 70% |
| #31 | Fix shell name matching | Low | 70% |
| #34 | Fix PowerShell quoting | Medium | 60% |
### P4 (Known Limitations / External)
| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #33 | Add PowerShell syntax hints in documentation | Low | 60% |
| #35 | Add delete verification (file exists check) | Medium | 40% |
| #12 | tree-sitter parser latency (known limitation) | N/A | 90% |
| #6 | ripgrep files() stream handling | Low | 100% |
---

## Bun.spawn Usage Across Codebase
| File | Usage | Stream Handling | Issues |
|------|-------|-----------------|--------|
| `bash.ts` | 1 | Complex (Promise.race + Promise.all) | #17, #18, #20 |
| `prompt.ts` | 2 | Simple (await proc.exited) | #19, #21, #22 |
| `grep.ts` | 1 | Simple (new Response) | #24 |
| `ripgrep.ts` | 3 | Complex (getReader loop) | #23 |
| `lsp/server.ts` | ~50+ | Long-running processes | N/A (intentional) |
| `format/index.ts` | 1 | Fire-and-forget | ⚠️ Ignores output |
| `format/formatter.ts` | 2 | Check capability only | ✅ OK |
---

## References
- [Bun Subprocess Documentation](https://bun.sh/docs/runtime/subprocess)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)
- [Stream API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
---

## Issue Table (Sorted by Confidence)

| # | Issue | Severity | Status | Confidence | Root Cause | Location |
|---|-------|----------|--------|------------|------------|----------|
| **UNFIXED BUGS - TESTED JANUARY 8, 2026 (3 issues)** | | | | | | |
| **PARTIAL FIX (1 issue)** | | | | | | |
| 1 | PowerShell/CMD double-wrapping | HIGH | ⚠️ PARTIAL | 100% | Shell wrapper works for CMD, not PowerShell | bash.ts:278 |
| **95% CONFIDENCE (2 issues)** | | | | | | |
| 10 | PowerShell inline execution | HIGH | ❌ UNFIXED | 100% | Commands echoed not executed - TESTED | bash.ts:296-302 |
| 13 | PowerShell command execution | HIGH | ❌ UNFIXED | 100% | Shell bypass inconsistency - TESTED | bash.ts:138-147 |
| **90% CONFIDENCE (4 issues)** | | | | | | |
| 14 | PowerShell -Command script blocks | HIGH | ❌ UNFIXED | 90% | Script blocks treated as literal text | bash.ts:291 |
| 36 | PowerShell -File path escaping | HIGH | ❌ UNFIXED | 90% | Backslash handling in paths | bash.ts:288-292 |
| 37 | Batch file execution | HIGH | ❌ UNFIXED | 90% | Quote handling in cmd wrapper | bash.ts:288-292 |
| **85% CONFIDENCE (3 issues)** | | | | | | |
| 16 | Exit code error handling | MEDIUM | ⚠️ NEEDS IMPROVE | 85% | Silent failures | bash.ts:405 |
| 17 | Output truncation mid-line | MEDIUM | ⚠️ UX ISSUE | 85% | Check before adding | bash.ts:316 |
| 18 | Windows path escaping | MEDIUM | ⚠️ NEEDS FIX | 85% | Backslash handling across layers | bash.ts:288-292 |
| 38 | Windows del command not recognized | HIGH | ❌ UNFIXED | 85% | Shell wrapper bypasses CMD built-ins | bash.ts:288-292 |
| 40 | Script block execution | HIGH | ❌ UNFIXED | 85% | `& { ... }` treated as literal | bash.ts:291 |
| **80% CONFIDENCE (7 issues)** | | | | | | |
| 20 | Timeout handling | LOW | ⚠️ SUBOPTIMAL | 80% | Arbitrary buffer | bash.ts:367 |
| 21 | Missing timeout handling (prompt.ts) | LOW | ⚠️ NEEDS FIX | 80% | No timeout parameter | prompt.ts:1262 |
| 22 | Missing timedOut metadata (prompt.ts) | LOW | ⚠️ NEEDS FIX | 80% | No timedOut tracking | prompt.ts:1484 |
| 23 | parseCommand naive splitting | LOW | ⚠️ SUBOPTIMAL | 80% | No quote handling | bash.ts:139 |
| 24 | CMD double-escaping | MEDIUM | ⚠️ NEEDS FIX | 80% | Extra backslashes before quotes | bash.ts:288-292 |
| 25 | Output ambiguity | MEDIUM | ⚠️ NEEDS FIX | 80% | Can't distinguish echo vs execute | bash.ts:406-414 |
| 27 | File modification race | MEDIUM | ⚠️ NEEDS FIX | 75% | Concurrent access conflicts | bash.ts:200 |
| **75% CONFIDENCE (2 issues)** | | | | | | |
| 28 | Path resolution on Windows | MEDIUM | ⚠️ EDGE CASE | 75% | realpath failures | bash.ts:226 |
| 29 | Fallback to empty args (prompt.ts) | LOW | ⚠️ EDGE CASE | 75% | Unknown shell handling | prompt.ts:1329 |
| 39 | Base64 encoded commands fail | MEDIUM | ❌ UNFIXED | 75% | Encoding issues | bash.ts:288-292 |
| **70% CONFIDENCE (2 issues)** | | | | | | |
| 30 | Permission pattern extraction | MEDIUM | ⚠️ EDGE CASE | 70% | Variable expansion issues | bash.ts:207 |
| 31 | Shell name matching bug (prompt.ts) | LOW | ⚠️ EDGE CASE | 70% | Basename extraction | prompt.ts:1343 |
| **65% CONFIDENCE (1 issue)** | | | | | | |
| 32 | CMD quote/path handling | MEDIUM | ⚠️ NEEDS FIX | 65% | Double-escaping in shell wrapper | bash.ts:288-292 |
| **60% CONFIDENCE (2 issues)** | | | | | | |
| 33 | PowerShell -Path misuse | LOW | ❌ USER ERROR | 60% | User confused syntax | User error |
| 34 | PowerShell quoting issues (prompt.ts) | LOW | ⚠️ EDGE CASE | 60% | Hardcoded args | prompt.ts:1381 |
| **40% CONFIDENCE (1 issue)** | | | | | | |
| 35 | Files remain after delete | MEDIUM | ❓ EXTERNAL | 40% | Lock/permission/path | External |
| **41** | Desktop app port conflict | LOW | ⚠️ NEEDS FIX | 100% | No port conflict handling | vite.config.ts |
| **42** | Python3 alias triggers Store prompt | LOW | ❌ UNFIXED | 100% | Windows alias behavior | External |

---

## Fresh Test Results: Issue #1 - PowerShell/CMD Double-Wrapping (January 8, 2026 17:52 UTC)

### Test Commands Executed
| # | Command | Exit Code | stdout | Result |
|---|---------|-----------|--------|--------|
| 1 | `powershell -NoProfile -Command "Write-Host 'Test123'"` | 0 | `Write-Host 'Test123'` | ❌ FAIL - Echoes command string |
| 2 | `powershell -NoProfile -Command "Get-Date | Out-String"` | 0 | `Get-Date | Out-String` | ❌ FAIL - Echoes command string |
| 3 | `cmd /c echo HelloWorld` | 0 | `HelloWorld` | ✅ PASS - Executes correctly |
| 4 | `cmd /c dir` | 0 | Directory listing | ✅ PASS - Executes correctly |

### Summary
- **PowerShell Tests**: 2/2 FAILED - Commands echo the command string as output instead of executing
- **CMD Tests**: 2/2 PASSED - Commands execute correctly and produce expected output

### Conclusion
**Issue #1 is NOT FIXED for PowerShell commands.** The double-wrapping fix works for CMD but not for PowerShell inline `-Command` execution. This aligns with Issue #10 (PowerShell inline execution is a documented limitation).

---

## Issue #10: PowerShell Inline Execution - NOT EXECUTING

### Current Status

| Aspect | Finding |
|--------|---------|
| **Severity** | HIGH |
| **Status** | ⚠️ NEEDS FIX |
| **Confidence** | 95% |
| **Location** | `bash.ts:296-302` |
| **Root Cause** | Commands echoed but not executed by PowerShell |

### Problem Summary
Direct PowerShell commands executed via the Bash tool are **echoed but not executed**. Command strings are returned as output rather than being executed by PowerShell.

### Test Results
#### 1. Direct PowerShell Commands (ALL FAILED)
**Invocation Methods Tested:**
| Method | Result |
|--------|--------|
| `powershell -NoProfile -Command "..."` | ❌ Echoed |
| `powershell.exe -Command "..."` | ❌ Echoed |
| `powershell -NoProfile "..."` | ❌ Echoed |
| `powershell -Command "..."` | ❌ Echoed |

#### 2. PS1 Script Files (ALL SUCCESSFUL)
| Method | Result |
|--------|--------|
| `powershell -ExecutionPolicy Bypass -File script.ps1` | ✅ Works |
| `powershell -NoProfile -File script.ps1` | ✅ Works |
| `powershell -File script.ps1` | ✅ Works |

#### 3. CMD Wrapper (SUCCESSFUL)
| Pattern | Result |
|---------|--------|
| `cmd /c [command]` | ✅ Works (without quotes) |

### Recommended Workarounds
#### Option 1: PS1 Script Files (RECOMMENDED)
```powershell
# Create script file
write_to_file script.ps1: "Write-Host 'Hello'"
# Execute
powershell -ExecutionPolicy Bypass -File script.ps1
```
#### Option 2: CMD Wrapper
```bash
cmd /c powershell -Command "Write-Host 'Hello'"
```

---

## Issue #13: PowerShell Command Execution - REOPENED ⚠️

### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | HIGH |
| **Status** | ⚠️ REOPENED |
| **Confidence** | 90% |
| **Location** | `bash.ts:148`, `bash.test.ts:44`, `bash-windows.test.ts:39` |
| **Root Cause** | INCONSISTENT TEST EXPECTATIONS |

### 🚨 CRITICAL FINDING: Test Inconsistency
**The tests expect OPPOSITE values for `shouldBypassShell`!**

**bash.test.ts (Unix tests) - Line 42-47:**
```typescript
it("should bypass shell for powershell.exe commands", () => {
  const result = parseCommand("powershell.exe -Command Get-Process")
  expect(result.shouldBypassShell).toBe(true)  // ← Expects TRUE
})
```

**bash-windows.test.ts (Windows tests) - Line 37-42:**
```typescript
test("parseCommand uses shell wrapper for PowerShell", () => {
  const result = parseCommand("powershell.exe -Command Get-Process")
  expect(result.shouldBypassShell).toBe(false)  // ← Expects FALSE!
})
```

### Impact
- The code is actually CORRECT for Windows (uses shell wrapper)
- The Unix test is WRONG (expects bypass, but code uses wrapper)

---

## Issue #14: PowerShell -Command Script Blocks Treated as Literals

### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | HIGH |
| **Status** | ⚠️ NEEDS FIX |
| **Confidence** | 90% |
| **Location** | `bash.ts:291` |
| **Root Cause** | PowerShell -Command receives string as literal text |

### Problem Summary
When executing PowerShell commands with script blocks via the Bash tool, complex commands with conditionals, multiple statements, or output functions are treated as literal text to echo rather than code to execute.

### Workaround
**Solution: Use -File parameter instead of -Command**
```powershell
# Create script file
write_to_file script.ps1: '''
if (Test-Path 'file.md') {
  Remove-Item 'file.md' -Force
  Write-Output 'Deleted'
} else {
  Write-Output 'Not found'
}
'''
# Execute via file
powershell -NoProfile -ExecutionPolicy Bypass -File script.ps1
```

---

## Issue #18: Windows Path Escaping Across Shell Layers

### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | MEDIUM |
| **Status** | ⚠️ NEEDS FIX |
| **Confidence** | 85% |
| **Location** | `bash.ts:288-292` |
| **Root Cause** | Backslash handling differs across Bash → PowerShell layers |

### Recommended Solutions
**Option 1: Use Forward Slashes**
```powershell
powershell -Command "Remove-Item 'C:/path/to/file.md' -Force"
```
**Option 2: Use -LiteralPath (PowerShell)**
```powershell
powershell -Command "Remove-Item -LiteralPath 'C:\\path\\to\\file.md' -Force"
```

---

## Issue #25: Output Ambiguity - Echo vs Execute

### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | MEDIUM |
| **Status** | ⚠️ NEEDS FIX |
| **Confidence** | 80% |
| **Location** | `bash.ts:406-414` |
| **Root Cause** | PowerShell returns exit code 0 even for literal string "execution" |

### Problem Summary
When PowerShell echoes a command back instead of executing it, the Bash tool returns:
- Exit code: 0 (appears successful)
- Full command string as stdout
- No indication of failure

### Recommended Solution
Add explicit output verification in commands:
```powershell
powershell -Command "Remove-Item 'file.md' -Force; if (-not (Test-Path 'file.md')) { Write-Host 'SUCCESS' }"
```

---

## Additional Test Report: File Deletion & Complex Commands - January 8, 2026

### Summary
Extended testing with complex PowerShell and CMD commands for file deletion operations. Results reveal **additional failure patterns** not previously documented.

### Commands That Failed
| # | Command | Result | Error |
|---|---------|--------|-------|
| 1 | `powershell -NoProfile -Command "Remove-Item '...\.md' -Force; Write-Host 'Done'"` | ❌ Echoed | Command echoed back, no execution |
| 2 | `powershell -NoProfile -Command "& { Remove-Item '...\.md' -Force; Write-Output 'Test' }"` | ❌ Echoed | Script block treated as literal text |
| 3 | `powershell -NoProfile -File "E:/path/to/script.ps1"` | ❌ ERROR | "Illegal characters in path" for backslash in "Level\ 2" |
| 5 | `cmd /c "cleanup.bat"` | ❌ ERROR | "filename syntax incorrect" |
| 6 | `cmd.exe /c "del /F E:\...\file.md"` | ❌ ERROR | 'del' is not recognized |
| 7 | `powershell -NoProfile -EncodedCommand "..."` | ❌ ERROR | "not properly encoded" |

### What Still Works
| Command | Result | Notes |
|---------|--------|-------|
| `powershell -NoProfile -Command "Remove-Item '...\file.md' -Force"` | ✅ SUCCESS | Simple single commands work |

### New Issues Identified
| Issue | Severity | Description | Root Cause |
|-------|----------|-------------|------------|
| #36 | HIGH | PowerShell -File path with backslashes | Path escaping across shell layers |
| #37 | HIGH | CMD batch file execution | Quote handling in cmd.exe wrapper |
| #38 | HIGH | Windows del command not recognized | Shell wrapper bypasses CMD built-ins |
| #39 | MEDIUM | Base64 encoded commands fail | Encoding issues with PowerShell |
| #40 | HIGH | Script block execution | `& { ... }` treated as literal text |

---

## Issue #27: File Modification Race Conditions

### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | MEDIUM |
| **Status** | ⚠️ NEEDS FIX |
| **Confidence** | 75% |
| **Location** | `bash.ts:200` |
| **Root Cause** | Concurrent edits to same file |

### Problem Summary
When multiple processes access the same file simultaneously:
- File modification conflicts occur
- Error: "File ... has been modified since it was last read"

### Required Fix
Implement file locking mechanism or operation coordination to prevent race conditions.

---

## END OF INVESTIGATION REPORT
