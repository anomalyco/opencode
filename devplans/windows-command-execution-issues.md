# Windows Command Execution - Comprehensive Issue Analysis

## Executive Summary

Complete investigation of Windows command execution issues across all related files. **29 issues identified** with confidence-sorted analysis.

**Status Update**:
- **Fixed Issues (8)**: #1, #2, #16, #17, #18, #19, #27, #29
- **Unfixed Issues (20)**: #4, #5, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #21, #22, #23, #24, #25, #26, #28
- Issue #20: No cleanup on early abort - marked as NOT A BUG (removed from active list)

---

## Issue Table (Sorted by Confidence)

| # | Issue | Severity | Status | Confidence | Root Cause | Location |
|---|-------|----------|--------|------------|------------|----------|
| **FIXED ISSUES (8 issues)** | | | | | | |
| 1 | PowerShell/CMD double-wrapping | HIGH | ✅ FIXED | 100% | Shell wrapper always used | bash.ts:278 |
| 2 | Environment variable handling | MEDIUM | ✅ FIXED | 100% | Missing Git env vars | git-env.ts:69 |
| 17 | Stream reading race condition | HIGH | ✅ FIXED | 100% | Promise.race() data loss | bash.ts:372 |
| 18 | Duplicate abort listeners | LOW | ✅ FIXED | 100% | Two handlers on same signal | bash.ts:361 + 376 |
| 19 | Missing stream draining | MEDIUM | ✅ FIXED | 100% | No Promise.all for streams | prompt.ts:1483 |
| 16 | No shell bypass (prompt.ts) | HIGH | ✅ FIXED | 95% | Added bypass logic | prompt.ts:1397 |
| 27 | PowerShell command execution | HIGH | ✅ FIXED | 90% | Shell bypass prevents proper parsing | bash.ts:138-147 + prompt.ts:82-91 |
| 29 | Desktop "Server not running" race condition | LOW | ✅ FIXED | 100% | ServerState initialized too late | lib.rs:299 |
| **UNFIXED ISSUES (20 issues)** | | | | | | |
| 23 | ripgrep files() stream handling | LOW | ⚠️ NEEDS FIX | 100% | Complex stream reading | ripgrep.ts:242 |
| 8 | tree-sitter parser latency | MEDIUM | ℹ️ KNOWN | 90% | WASM loading on first use | bash.ts:31 |
| 24 | grep tool stream handling | LOW | ⚠️ EDGE CASE | 95% | Simple await pattern | grep.ts:47 |
| 5 | Exit code error handling | MEDIUM | ⚠️ NEEDS IMPROVE | 85% | Silent failures | bash.ts:405 |
| 12 | Output truncation mid-line | MEDIUM | ⚠️ UX ISSUE | 85% | Check before adding | bash.ts:316 |
| 11 | Timeout handling | LOW | ⚠️ SUBOPTIMAL | 80% | Arbitrary buffer | bash.ts:367 |
| 21 | Missing timeout handling (prompt.ts) | LOW | ⚠️ NEEDS FIX | 80% | No timeout parameter | prompt.ts:1262 |
| 22 | Missing timedOut metadata (prompt.ts) | LOW | ⚠️ NEEDS FIX | 80% | No timedOut tracking | prompt.ts:1484 |
| 4 | parseCommand naive splitting | LOW | ⚠️ SUBOPTIMAL | 80% | No quote handling | bash.ts:139 |
| 28 | CMD double-escaping | MEDIUM | ⚠️ NEEDS FIX | 80% | Extra backslashes before quotes | bash.ts:288-292 |
| 10 | Path resolution on Windows | MEDIUM | ⚠️ EDGE CASE | 75% | realpath failures | bash.ts:226 |
| 14 | Fallback to empty args (prompt.ts) | LOW | ⚠️ EDGE CASE | 75% | Unknown shell handling | prompt.ts:1329 |
| 9 | Permission pattern extraction | MEDIUM | ⚠️ EDGE CASE | 70% | Variable expansion issues | bash.ts:207 |
| 13 | Shell name matching bug (prompt.ts) | LOW | ⚠️ EDGE CASE | 70% | Basename extraction | prompt.ts:1343 |
| 25 | CMD quote/path handling | MEDIUM | ⚠️ NEEDS FIX | 70% | Double-escaping in shell wrapper | bash.ts:288-292 |
| 6 | PowerShell -Path misuse | LOW | ❌ USER ERROR | 60% | User confused syntax | User error |
| 15 | PowerShell quoting issues (prompt.ts) | LOW | ⚠️ EDGE CASE | 60% | Hardcoded args | prompt.ts:1381 |
| 26 | Edit tool multi-line patterns | MEDIUM | ⚠️ NEEDS FIX | 60% | Empty lines break matching | edit.ts |
| 7 | Files remain after delete | MEDIUM | ❓ EXTERNAL | 40% | Lock/permission/path | External |

---

## Issue #29: Desktop "Server not running" Race Condition - FIXED ✅

### Current Status

| Aspect | Finding |
|--------|---------|
| **Severity** | LOW |
| **Status** | ✅ FIXED |
| **Confidence** | 100% |
| **Location** | `packages/desktop/src-tauri/src/lib.rs:219-222`, `lib.rs:301-305` |
| **Root Cause** | ServerState initialized too late (inside async block after window build) |

### Root Cause Analysis

**The Issue:** When the Tauri desktop app received an exit event, the `kill_sidecar()` function tried to access `ServerState` which hadn't been initialized yet. This happened because:

1. `ServerState` was only created at line 299, inside an async spawn block
2. The async block runs AFTER the window is built (lines 276-296)
3. If the user closed the app before line 299 executed, `ServerState` didn't exist
4. `kill_sidecar()` at line 32 would fail the `try_state()` check and print "Server not running"

### Fix Applied

**Location**: `packages/desktop/src-tauri/src/lib.rs:219-222`, `lib.rs:301-305`

- Initialize `ServerState` early (at line 221) before async spawn
- Update existing state instead of creating new one when server spawns
- Improved error message from "Server not running" to "Server state not initialized (app closed before server started)"

### Verification

- Build: ✅ Succeeded after cargo clean
- Test: ✅ Closing app quickly no longer shows "Server not running" error

### Files Changed

| File | Lines | Change | Status |
|------|-------|--------|--------|
| `packages/desktop/src-tauri/src/lib.rs` | 219-222 | Add early ServerState initialization | ✅ APPLIED |
| `packages/desktop/src-tauri/src/lib.rs` | 301-305 | Update existing state instead of managing new | ✅ APPLIED |
| `packages/desktop/src-tauri/src/lib.rs` | 33 | Improve error message | ✅ APPLIED |

---

## Action Plan

### P0 (Already Fixed - 8 Issues)

| Issue | Action | Status | Confidence |
|-------|--------|--------|------------|
| #1 | Add shell bypass to bash.ts | ✅ FIXED | 100% |
| #2 | Add Git cmd and MinGW paths to git-env.ts | ✅ FIXED | 100% |
| #16 | Add shell bypass to prompt.ts | ✅ FIXED | 95% |
| #17 | Fix stream reading race condition | ✅ FIXED | 100% |
| #18 | Remove duplicate abort listeners from bash.ts | ✅ FIXED | 100% |
| #19 | Add stream draining to prompt.ts | ✅ FIXED | 100% |
| #27 | Fix PowerShell command execution | ✅ FIXED | 90% |
| #29 | Fix desktop race condition | ✅ FIXED | 100% |

### P1 (High Priority Unfixed Issues)

| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #28 | Fix CMD double-escaping | Easy | 80% |
| #25 | Fix CMD quote/path handling | Medium | 70% |
| #23 | Review ripgrep files() stream reading | Low | 100% |
| #24 | Review grep.ts edge cases | Low | 95% |
| #26 | Fix Edit tool multi-line patterns | Medium | 60% |

### P2 (Medium Priority)

| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #5 | Improve error handling for exit codes | Low | 85% |
| #12 | Improve output truncation | Low | 85% |
| #21 | Add timeout handling to prompt.ts | Medium | 80% |
| #22 | Add timedOut metadata to prompt.ts | Easy | 80% |
| #4 | Use shell-quote for argument parsing | Medium | 80% |
| #11 | Adaptive timeout handling | Medium | 80% |

### P3 (Lower Priority / Edge Cases)

| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #10 | Add UNC path support | Medium | 75% |
| #14 | Improve fallback handling | Low | 75% |
| #9 | Handle variable expansion in patterns | Medium | 70% |
| #13 | Fix shell name matching | Low | 70% |
| #15 | Fix PowerShell quoting | Medium | 60% |

### P4 (Known Limitations / External)

| Issue | Action | Effort | Confidence |
|-------|--------|--------|------------|
| #6 | Add PowerShell syntax hints in documentation | Low | 60% |
| #7 | Add delete verification (file exists check) | Medium | 40% |
| #8 | tree-sitter parser latency (known limitation) | N/A | 90% |

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
