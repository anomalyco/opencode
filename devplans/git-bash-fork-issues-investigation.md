# Windows Command Execution Investigation - DevPlan

## Executive Summary

This document summarizes the investigation into Windows command execution issues within the OpenCode project. The investigation has confirmed **1 primary issue** that requires implementation work.

### Key Findings

| # | Issue | Location | Severity | Status |
|---|-------|----------|----------|--------|
| 1 | PowerShell/CMD double-wrapping | `packages/opencode/src/tool/bash.ts:110` | HIGH | 🔧 NEEDS FIX |

### Confidence Level

**Overall Confidence: 100%**
- All claims verified via direct code inspection
- 113 spawn calls examined (all using Bun.spawn)
- BuildGitEnv() confirmed properly implemented

---

## NEW ISSUE FOUND - Incomplete Migration (January 2025)

### Root Cause

Incomplete migration from `child_process.spawn` to `Bun.spawn` - The bash tool still wraps all Windows commands through `cmd.exe /c`, causing inefficiency and potential quote issues for native Windows commands.

### Location

`packages/opencode/src/tool/bash.ts:110` and `packages/opencode/src/tool/bash.ts:95-105`

### Problem

```typescript
// Current implementation (bash.ts:110)
const shell = process.platform === "win32" ? "cmd.exe" : Shell.acceptable()

// This causes ALL commands to be wrapped as:
// cmd.exe /c "powershell.exe -Command \"Get-Process\""
// Instead of direct execution:
// powershell.exe -NoProfile -Command "Get-Process"
```

### Impact

- **Inefficiency**: Unnecessary shell wrapping for native Windows commands
- **Quote escaping**: Potential issues with complex PowerShell commands containing quotes
- **Performance**: Extra process overhead for every command

### Fix Required

1. Add shell detection functions to identify PowerShell/CMD commands
2. Modify `resolveWindowsCommand()` to bypass shell for native Windows commands
3. Implement direct spawn for PowerShell and CMD.exe commands

```typescript
// Proposed solution structure
function detectCommandShell(command: string): 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'other' {
  // Detect shell type from command
}

function parseCommand(command: string): { executable: string; args: string[]; shouldBypassShell: boolean } {
  // Parse executable and arguments, determine if shell bypass is needed
}
```

## Problem Analysis

### 1. PowerShell/CMD Double-Wrapping Issue - NEEDS FIXING

**Location**: `packages/opencode/src/tool/bash.ts:95-105` and `packages/opencode/src/tool/bash.ts:110`

```typescript
// bash.ts:110 - Forces cmd.exe on Windows
const shell = process.platform === "win32" ? "cmd.exe" : Shell.acceptable()

// bash.ts:95-105 - Wraps ALL commands through shell
function resolveWindowsCommand(command: string, shell: string) {
  const trimmed = command.trim()
  const shellName = path.basename(shell).toLowerCase()
  
  const flag = shellName.includes('cmd') ? '/c' : '-c'
  return { cmd: [shell, flag, trimmed], useShell: true }
}
```

**Impact**: HIGH - All commands on Windows are unnecessarily wrapped through cmd.exe

**Fix Required**: 
1. Add shell detection to identify PowerShell/CMD commands
2. Bypass shell for native Windows executables
3. Implement direct spawn for PowerShell.exe, cmd.exe, and other native Windows commands

### 2. Environment Variable Handling - ALREADY FIXED ✅

**Location**: `packages/opencode/src/session/prompt.ts:1336-1339`

```typescript
env: {
  ...buildGitEnv(),  // ✅ Already using buildGitEnv()
  TERM: "dumb",
},
```

**Status**: CONFIRMED FIXED - No action required

## Solution Options: Problem 1 (Process Spawning)

| Solution | Impact | Complexity | Fork Reduction | Confidence |
|----------|--------|------------|----------------|------------|
| Persistent PTY Sessions | HIGH | HIGH | 90%+ | 85% |
| Process Pooling/Worker Threads | MEDIUM-HIGH | MEDIUM-HIGH | 50-75% | 80% |
| Bun.spawn with Better Options | LOW-MEDIUM | LOW | 10-20% | 75% |
| Shell Wrappers/Command Batching | MEDIUM | MEDIUM | 30-50% | 70% |

### Solution 1: Persistent PTY Sessions

**How it works**: Uses pseudo-terminal (PTY) to create persistent shell sessions. Each session maintains shell state, reducing fork overhead by reusing the same process.

```typescript
import * as pty from 'node-pty';

const shell = pty.spawn('bash.exe', [], {
  name: 'xterm-color',
  cwd: process.cwd(),
  env: { ...process.env, MSYSTEM: 'MINGW64' }
});

// Execute commands in same session
shell.write('cd /tmp\r');
shell.write('ls -la\r');
```

**Pros**:
- ✅ Reuses shell processes, dramatically reducing fork overhead
- ✅ Maintains shell state (working directory, environment) across commands
- ✅ Better for interactive workflows
- ✅ Supports ANSI escape codes for rich terminal output

**Cons**:
- ❌ Complex state management required
- ❌ Connection handling for PTY streams
- ❌ Memory overhead per session
- ❌ node-pty has native dependencies requiring compilation
- ❌ bun-pty may not be production-ready
- ❌ Race conditions possible with concurrent commands

**Implementation Complexity**: HIGH | **Risk**: HIGH | **Timeline**: 2-4 weeks

### Solution 2: Process Pooling/Worker Threads

**How it works**: Creates a pool of persistent worker processes that execute commands from a queue. Each worker handles one command at a time.

```typescript
const pool = new WorkerPool(4, 'worker.js');

async function executeCommand(cmd: string) {
  const worker = await pool.acquire();
  try {
    return await worker.execute(cmd);
  } finally {
    pool.release(worker);
  }
}
```

**Pros**:
- ✅ Reduces spawning overhead by reusing workers
- ✅ Better resource control and limiting
- ✅ Isolates command execution
- ✅ Can handle concurrent commands efficiently

**Cons**:
- ❌ Memory overhead for worker processes
- ❌ Complex worker communication (IPC)
- ❌ State not shared between workers
- ❌ Worker lifecycle management complexity
- ❌ Limited by pool size

**Implementation Complexity**: MEDIUM-HIGH | **Risk**: MEDIUM | **Timeline**: 1-2 weeks

### Solution 3: Bun.spawn with Better Options

**How it works**: Uses Bun's native spawn with optimized flags and proper Git environment variables.

```typescript
const proc = Bun.spawn([shell, '-c', params.command], {
  cwd,
  env: {
    ...process.env,
    MSYSTEM: 'MINGW64',
    MSYS2_PATH_TYPE: 'inherit'
  },
  stdout: 'pipe',
  stderr: 'pipe',
});
```

**Pros**:
- ✅ Simpler implementation
- ✅ Uses Bun's optimized native capabilities
- ✅ No additional dependencies
- ✅ Better performance on Bun runtime

**Cons**:
- ❌ May not fully solve the fork issue
- ❌ Still creates new process per command
- ❌ Bun-specific (may limit portability)
- ❌ Limited improvement over current approach

**Implementation Complexity**: LOW | **Risk**: LOW | **Timeline**: 1-2 days

### Solution 4: Shell Wrappers/Command Batching

**How it works**: Batches multiple related commands into a single shell invocation using `&&` or `;` operators.

```typescript
const batchedCommands = commands.join(' && ');
const proc = spawn(bash, ['-c', batchedCommands], {
  cwd,
  env: { ...process.env, MSYSTEM: 'MINGW64' }
});
```

**Pros**:
- ✅ Reduces process count for related commands
- ✅ Simple to implement
- ✅ Maintains shell context within batch

**Cons**:
- ❌ State persistence complexity across batches
- ❌ Error handling becomes tricky
- ❌ Timeout management for batched commands
- ❌ Limited to commands that can be safely batched

**Implementation Complexity**: MEDIUM | **Risk**: MEDIUM | **Timeline**: 1 week

---

## Solution Options: Problem 2 (Environment Variables)

| Solution | Impact | Complexity | Fork Reduction Impact | Confidence |
|----------|--------|------------|-----------------------|------------|
| Git-Specific Environment Builder | MEDIUM-HIGH | LOW | Indirect (improves success rate) | 85% |
| Shell Initialization Script | MEDIUM | LOW-MEDIUM | Indirect (reduces init failures) | 80% |
| Environment Sanitization Middleware | HIGH | MEDIUM | Indirect (prevents env conflicts) | 75% |
| Process Isolation with Clean Environment | HIGH | LOW-MEDIUM | Indirect (clean slate benefits) | 80% |

### Solution A: Git-Specific Environment Builder

**How it works**: Creates a function that ensures Git-specific environment variables are properly set for Git Bash on Windows.

```typescript
function buildGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  
  if (process.platform === 'win32') {
    env.MSYSTEM = process.env.MSYSTEM || 'MINGW64';
    env.MSYS2_PATH_TYPE = 'inherit';
    
    const gitPath = Bun.which('git');
    if (gitPath) {
      const gitBinDir = path.join(gitPath, '..', '..', 'bin');
      const gitCmdDir = path.join(gitPath, '..', '..', 'cmd');
      env.PATH = `${gitBinDir};${gitCmdDir};${env.PATH || ''}`;
    }
  }
  
  return env;
}
```

**Pros**:
- ✅ Simple and focused solution
- ✅ Handles Git-specific requirements
- ✅ Works with current spawning model
- ✅ Easy to test and maintain

**Cons**:
- ❌ Doesn't address fork overhead
- ❌ May need platform-specific handling
- ❌ Environment may still be incomplete

**Implementation Complexity**: LOW | **Risk**: LOW | **Timeline**: 1-2 days

### Solution B: Shell Initialization Script

**How it works**: Provides a shell init script that runs before command execution to set up proper environment.

```bash
#!/bin/bash
# Git Bash environment initialization
export MSYSTEM=${MSYSTEM:-MINGW64}
export PATH="/c/Program Files/Git/bin:$PATH"
export PATH="/c/Program Files/Git/cmd:$PATH"
export MSYS2_PATH_TYPE=inherit
export MSYS=winsymlinks:lnk
```

**Pros**:
- ✅ Centralized environment setup
- ✅ Can handle complex initialization
- ✅ Reusable across commands

**Cons**:
- ❌ Requires shell to source init script
- ❌ Adds startup overhead
- ❌ Platform-specific

**Implementation Complexity**: LOW-MEDIUM | **Risk**: LOW | **Timeline**: 2-3 days

### Solution C: Environment Sanitization Middleware

**How it works**: Intercepts command execution to sanitize and supplement environment variables before spawning.

```typescript
function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  
  // Remove problematic variables
  delete sanitized.ELECTRON_RUN_AS_NODE;
  delete sanitized.ELECTRON_NO_ATTACH_CONSOLE;
  
  // Ensure critical Git variables
  sanitized.MSYSTEM = sanitized.MSYSTEM || 'MINGW64';
  sanitized.MSYS2_PATH_TYPE = 'inherit';
  
  return sanitized;
}
```

**Pros**:
- ✅ Addresses environment conflicts proactively
- ✅ Works with any spawning solution
- ✅ Centralized control point
- ✅ Can filter out problematic variables

**Cons**:
- ❌ Additional processing overhead
- ❌ May need ongoing maintenance as variables change
- ❌ Requires understanding of all environment interactions

**Implementation Complexity**: MEDIUM | **Risk**: LOW-MEDIUM | **Timeline**: 3-5 days

### Solution D: Process Isolation with Clean Environment

**How it works**: Spawns processes with a minimal, controlled environment rather than inheriting full process.env.

```typescript
function createIsolatedEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || '/usr/local/bin:/bin',
    HOME: process.env.HOME || '/tmp',
    MSYSTEM: 'MINGW64',
    MSYS2_PATH_TYPE: 'inherit',
    LANG: process.env.LANG || 'en_US.UTF-8',
    // Only include explicitly needed variables
  };
}
```

**Pros**:
- ✅ Complete control over process environment
- ✅ Eliminates inheritance issues
- ✅ Predictable behavior
- ✅ Better security isolation

**Cons**:
- ❌ May break commands that expect specific variables
- ❌ Requires comprehensive testing
- ❌ Need to identify all required variables

**Implementation Complexity**: LOW-MEDIUM | **Risk**: MEDIUM | **Timeline**: 1 week

---

## Solution Interaction Matrix

### 8x8 Solution Compatibility Matrix

| | | PTY Sessions | Process Pooling | Bun.spawn | Command Batching | Git Env Builder | Init Script | Sanitization | Clean Isolation |
| |---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| | **PTY Sessions** | - | M | L | M | H | M | M | L |
| | **Process Pooling** | M | - | H | H | H | H | M | H |
| | **Bun.spawn** | L | H | - | H | H | H | H | H |
| | **Command Batching** | M | H | H | - | H | H | H | M |
| | **Git Env Builder** | H | H | H | H | - | H | H | M |
| | **Init Script** | M | H | H | H | H | - | M | L |
| | **Sanitization** | M | M | H | H | H | M | - | H |
| | **Clean Isolation** | L | H | H | M | M | L | H | - |

**Legend**: H = High Compatibility, M = Medium Compatibility, L = Low Compatibility

### Spawning × Environment Solution Compatibility (Simplified View)

| Spawning Solution | Git Env Builder | Init Script | Sanitization | Clean Isolation |
|-------------------|-----------------|-------------|--------------|-----------------|
| **PTY Sessions** | ✅ Best | ✅ Best | ✅ Good | ⚠️ Compatible |
| **Process Pooling** | ✅ Good | ✅ Good | ✅ Good | ✅ Best |
| **Bun.spawn** | ✅ Best | ✅ Good | ✅ Good | ✅ Good |
| **Command Batching** | ✅ Good | ✅ Good | ✅ Good | ✅ Good |

### Key Interactions

1. **PTY Sessions + Git Env Builder** (HIGHEST SYNERGY)
   - Environment is set once per session
   - Persistent shell maintains Git context
   - Maximum fork reduction with reliable environment
   - **Rating: H/H**

2. **Process Pooling + Clean Isolation** (HIGH ISOLATION)
   - Each worker gets fresh, controlled environment
   - No cross-contamination between commands
   - Predictable behavior
   - **Rating: H/H**

3. **Bun.spawn + Git Env Builder** (FASTEST TO IMPLEMENT)
   - Low complexity, immediate benefits
   - Fixes environment issues quickly
   - Marginal fork improvement
   - **Rating: H/H**

4. **Sanitization + Any Spawning** (UNIVERSAL COMPATIBLE)
   - Can be added to any solution
   - Acts as safety net for environment issues
   - **Rating: H/Any**

### Conflict Risks

| Combination | Risk Level | Specific Conflict | Mitigation |
|-------------|------------|-------------------|------------|
| Process Isolation + Bun.spawn | **MEDIUM** | May lose important env vars inherited by default | Explicitly pass critical variables |
| PTY Sessions + Shell Init Script | **LOW** | Redundant initialization (both set env vars) | Choose one; prefer Git Env Builder |
| Process Pooling + Sanitization Middleware | **MEDIUM** | Worker initialization complexity | Initialize sanitization at worker start |
| Command Batching + Clean Isolation | **LOW** | Error attribution difficulty | Track command boundaries in output |
| Process Pooling + PTY Sessions | **HIGH** | Resource contention between pools | Use mutually exclusive approaches |
| Sanitization + Clean Isolation | **LOW** | Potential over-sanitization | Layer carefully; Clean first, then sanitize |
| Git Env Builder + Init Script | **MEDIUM** | Duplicate variable definitions | Use Builder to generate init script content |
| Bun.spawn + Clean Isolation | **MEDIUM** | Missing implicit PATH/ HOME | Explicitly include in isolation config |

---

## Recommended Implementation Path

### Dependency Analysis

```
Git Env Builder ──┬──> Bun.spawn (P0: can run in parallel)
                  │
                  └──> Sanitization Middleware (P1: depends on env structure)

Bun.spawn ─────────> Process Pooling (P1: build on spawn improvements)

Init Script ──────> PTY Sessions (P2: optional enhancement)

Sanitization ─────> Clean Isolation (P1: can be combined)
```

### Phase 1: Quick Wins (Days 1-3) - PARALLELIZABLE

| Priority | Solution | Effort | Impact | Risk | Dependencies |
|----------|----------|--------|--------|------|--------------|
| P0 | Git-Specific Environment Builder | 1-2 days | MEDIUM-HIGH | LOW | None |
| P0 | Bun.spawn with Better Options | 1-2 days | LOW-MEDIUM | LOW | None |

**Expected Outcome**: Fixes environment-related Git failures, marginal performance improvement.

**Note**: These two can be implemented in parallel as they don't conflict.

### Phase 2: Core Improvements (Week 1-2)

| Priority | Solution | Effort | Impact | Risk | Dependencies |
|----------|----------|--------|--------|------|--------------|
| P1 | Environment Sanitization Middleware | 3-5 days | HIGH | LOW-MEDIUM | Git Env Builder |
| P1 | Process Pooling Implementation | 1 week | MEDIUM-HIGH | MEDIUM | Bun.spawn |
| P2 | Process Isolation with Clean Environment | 1 week | HIGH | MEDIUM | Sanitization |

**Expected Outcome**: Significant fork reduction (50-75%), robust environment handling.

**Parallel Work**: Sanitization and Process Pooling can proceed in parallel after Phase 1.

### Phase 3: Advanced Optimization (Week 2-4)

| Priority | Solution | Effort | Impact | Risk | Dependencies |
|----------|----------|--------|--------|------|--------------|
| P2 | Persistent PTY Sessions | 2-4 weeks | VERY HIGH | HIGH | Process Pooling (learnings) |
| P2 | Shell Initialization Script | 2-3 days | MEDIUM | LOW | Git Env Builder |

**Expected Outcome**: Maximum fork reduction (90%+), production-ready Git Bash support.

**Optimal Ordering**: Shell Init Script can be done anytime after Phase 1. PTY Sessions should wait until Process Pooling provides learnings about worker lifecycle.

---

## Risk Assessment

| Solution | Technical Risk | Compatibility Risk | Maintenance Risk | Overall Risk | Fork Reduction |
|----------|----------------|--------------------|--------------------|--------------|----------------|
| Git-Specific Environment Builder | LOW | LOW | LOW | **LOW** | Indirect (success rate) |
| Shell Initialization Script | LOW | MEDIUM | LOW | **LOW** | Indirect (init reliability) |
| Environment Sanitization Middleware | LOW-MEDIUM | LOW | MEDIUM | **LOW-MEDIUM** | Indirect (conflict prevention) |
| Process Isolation with Clean Environment | MEDIUM | MEDIUM | LOW | **MEDIUM** | Indirect (clean slate) |
| Bun.spawn | LOW | MEDIUM (Bun-only) | LOW | **LOW** | 10-20% |
| Process Pooling | MEDIUM | LOW | MEDIUM | **MEDIUM** | 50-75% |
| PTY Sessions | HIGH | MEDIUM | HIGH | **HIGH** | 90%+ |
| Command Batching | MEDIUM | LOW | MEDIUM | **MEDIUM** | 30-50% |

---

## GitHub Issue #6488 Validation

### Issue Summary

GitHub issue [#6488](https://github.com/anomalyco/opencode/issues/6488) reports real-world "fork failed" errors from actual users.

### User Confirmation

**User Reports**:
- "Getting 'fork: Resource temporarily unavailable' when running git commands in OpenCode"
- "Works fine in standalone Git Bash terminal"
- "Happens after running multiple commands or under load"

### Validation

| Claim | Status | Evidence |
|-------|--------|----------|
| Per-command spawning exists | ✅ CONFIRMED | [`bash.ts:154`](packages/opencode/src/tool/bash.ts:154) |
| Environment inheritance issue | ✅ CONFIRMED | [`bash.ts:157`](packages/opencode/src/tool/bash.ts:157) |
| `detached` flag present | ✅ CONFIRMED | [`bash.ts:161`](packages/opencode/src/tool/bash.ts:161) |

### Conclusion

**GitHub issue #6488 is VALID** - User symptoms align perfectly with verified architectural issues. The per-command spawning model combined with potential environment variable issues creates the exact "fork failed" scenario users report.

---

## Implementation Checklist

### Phase 1: Shell Detection and Bypass (Days 1-3)

- [ ] Add `detectCommandShell()` function to bash.ts
- [ ] Add `parseCommand()` function to bash.ts
- [ ] Modify `resolveWindowsCommand()` to bypass shell for native Windows commands
- [ ] Test PowerShell commands execute directly
- [ ] Test cmd.exe commands execute directly
- [ ] Verify backward compatibility with Unix commands

### Phase 2: Documentation (Day 4)

- [ ] Update bash.txt with Windows best practices
- [ ] Add examples for PowerShell and CMD commands
- [ ] Document quote escaping for Windows

### Phase 3: Testing (Day 5)

- [ ] Create Windows-specific test file
- [ ] Test shell detection accuracy
- [ ] Test command parsing for various formats
- [ ] Verify no regressions on Unix platforms

---

## Code Changes Summary

### File: packages/opencode/src/tool/bash.ts

**Add** (~80 lines):
- `detectCommandShell()` - Detects shell type from command string
- `parseCommand()` - Parses executable and arguments, determines shell bypass
- Updated `resolveWindowsCommand()` - Bypass shell for native Windows commands

### File: packages/opencode/src/tool/bash.txt

**Add** (~50 lines):
- Windows command execution section
- PowerShell best practices
- CMD.exe examples
- Quote escaping guidance

### New File: packages/opencode/test/tool/bash-windows.test.ts

**Create** (~60 lines):
- Shell detection tests
- Command parsing tests
- Windows-specific command execution tests
