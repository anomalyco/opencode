# Git Bash Tool Windows Fix Plan

## Executive Summary

This document outlines the investigation findings and fix plan for the Git Bash tool issues on Windows (win64). The bash tool has three distinct error patterns that need to be addressed:

1. **Type A**: `TypeError: proc.stdout?.on is not a function` - stdout type mismatch
2. **Type B**: "Executable not found in $PATH" - Shell built-ins failing
3. **Type C**: `ENOENT: no such file or directory` - uv_spawn issues

---

## Root Cause Analysis

### Type A: TypeError - proc.stdout?.on is not a function

**Location**: [`packages/opencode/src/tool/bash.ts:184-185`](packages/opencode/src/tool/bash.ts:184)

```typescript
proc.stdout?.on("data", append)
proc.stderr?.on("data", append)
```

**Root Cause**: The code assumes `proc.stdout` is a Node.js ReadableStream with `.on()` event emitter methods. However, Bun.spawn returns different types depending on platform and execution context:

- On Windows with native executables (git.exe, cmd.exe), stdout may be a `Buffer` or `Uint8Array`
- The `.on()` method only exists on `ReadableStream` objects, not raw buffers
- This causes `TypeError: proc.stdout?.on is not a function`

**Evidence**: The error message `proc.stdout?.on is undefined` indicates the property exists but is not a function, meaning `stdout` is present but lacks the event emitter interface.

**Comparison with prompt.ts**: The `shell()` function in `prompt.ts` uses a different approach:

```typescript
// prompt.ts uses getReader() - more compatible with Bun's API
const stdoutReader = proc.stdout?.getReader()
const stderrReader = proc.stderr?.getReader()
```

### Type B: Shell Built-ins Failing

**Affected Commands**: `echo`, `pwd`, `ls`, `cd`, `type`, `which`, `where`, `%USERPROFILE%`, `ver`, `time`, `set`, `chcp`, `exit`, `powershell.exe`, `bash`, `sh`

**Root Cause**: Shell built-ins are not standalone executables - they are built into the shell interpreter itself. When executing:

```typescript
const proc = Bun.spawn([params.command], {
  shell,  // shell is the path to bash.exe
  ...
})
```

The command is passed to the shell, but the shell may not properly handle built-in commands when invoked with certain options or on certain platforms.

**Windows Specific Issues**:
1. Git Bash's `bash.exe` may not properly interpret Windows-style commands
2. `cmd.exe` built-ins require `cmd.exe /c` wrapper
3. PowerShell built-ins require `powershell.exe -Command`

### Type C: ENOENT Error

**Error**: `ENOENT: no such file or directory, uv_spawn 'cmd.exe /c echo test'`

**Root Cause**: When spawning fails to find the executable:
1. Path resolution issues on Windows
2. Missing file extensions (.exe, .cmd, .bat)
3. Shell interpretation required but not provided

---

## Detailed Implementation

### Phase 1: Fix stdout Type Handling (Type A)

#### Current Code (bash.ts:172-227)

```typescript
// Line 172-182: append function
const append = (chunk: Buffer) => {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    output += chunk.toString()
    ctx.metadata({
      metadata: {
        output,
        description: params.description,
      },
    })
  }
}

// Line 184-185: Event-based stdout handling (PROBLEMATIC)
proc.stdout?.on("data", append)
proc.stderr?.on("data", append)

// Line 210-227: Promise-based exit handling
await new Promise<void>((resolve, reject) => {
  const cleanup = () => {
    clearTimeout(timeoutTimer)
    ctx.abort.removeEventListener("abort", abortHandler)
  }

  proc.once("exit", () => {
    exited = true
    cleanup()
    resolve()
  })

  proc.once("error", (error) => {
    exited = true
    cleanup()
    reject(error)
  })
})
```

#### Recommended Fix: Stream Reader Approach

```typescript
// Line 172-182: Updated append function - handles both Buffer and Uint8Array
const append = (chunk: Buffer | Uint8Array | string) => {
  const text = chunk instanceof Buffer || chunk instanceof Uint8Array 
    ? new TextDecoder().decode(chunk) 
    : chunk
  if (output.length <= MAX_OUTPUT_LENGTH) {
    output += text
    ctx.metadata({
      metadata: {
        output,
        description: params.description,
      },
    })
  }
}

// Line 184-185: Replace event-based with stream reader
const stdoutReader = proc.stdout?.getReader()
const stderrReader = proc.stderr?.getReader()

// Add new helper function for reading streams
const readOutput = async (reader: ReadableStreamDefaultReader | undefined, signal: AbortSignal): Promise<void> => {
  if (!reader) return
  try {
    while (!signal.aborted) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<{ done: true }>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Aborted")))
        })
      ])
      if (done) break
      append(value)
    }
  } catch (_e) {
    // Stream reading ended or was aborted
  }
}

// Line 186-200: Replace event listeners with concurrent stream reading
const readPromises: Promise<void>[] = []
if (stdoutReader) {
  readPromises.push(readOutput(stdoutReader, ctx.abort))
}
if (stderrReader) {
  readPromises.push(readOutput(stderrReader, ctx.abort))
}

// Wait for both streams to complete OR process to exit
await Promise.race([
  proc.exited,
  Promise.all(readPromises).then(() => proc.exited),
])
```

### Phase 2: Fix Shell Built-ins (Type B)

#### Detection Strategy

```typescript
// Shell built-ins that require shell wrapper
const SHELL_BUILTINS = new Set([
  // Bash built-ins
  "echo", "pwd", "ls", "cd", "type", "which", "where",
  "ver", "time", "set", "chcp", "exit", "history", "alias",
  "bg", "bind", "break", "builtin", "caller", "case", "command",
  "compgen", "complete", "continue", "declare", "dirs", "disown",
  "do", "done", "elif", "else", "esac", "eval", "exec", "export",
  "fc", "fg", "fi", "for", "function", "getopts", "hash", "help",
  "if", "in", "jobs", "kill", "let", "local", "logout", "mapfile",
  "popd", "pushd", "read", "readarray", "readonly", "return",
  "select", "shift", "suspend", "test", "then", "times", "trap",
  "true", "typeset", "ulimit", "umask", "unalias", "unset", "until",
  "wait", "while", 
  // Windows-specific patterns
  "%[^%]+%",  // Environment variable expansion
])

// Commands that look like shell built-ins (start with special characters)
const SHELL_PATTERN = /^%\w+%|\$\w+|\\$\{\w+\}/

function needsShellExecution(command: string): boolean {
  // Extract first word (handle quotes)
  const firstWord = command.trim().match(/^(["']?)(\S+)\1/)?.[2]?.toLowerCase() ?? ""
  
  // Check if it's a known shell built-in
  if (SHELL_BUILTINS.has(firstWord)) {
    return true
  }
  
  // Check if command contains shell-specific syntax
  if (SHELL_PATTERN.test(command)) {
    return true
  }
  
  // Check for shell operators
  if (/[;&|]/.test(command) && !command.startsWith("git") && !command.startsWith("npm")) {
    return true
  }
  
  return false
}
```

#### Execution Mode Selection

```typescript
// Line 154-160: Updated spawn logic
const useShellExecution = needsShellExecution(params.command)

const proc = Bun.spawn(
  useShellExecution 
    ? [shell, "-c", params.command]
    : [params.command],
  {
    shell: useShellExecution ? undefined : shell,
    cwd,
    env: buildGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  }
)
```

### Phase 3: Fix ENOENT Issues (Type C)

#### Windows Path Resolution

```typescript
function resolveWindowsCommand(command: string): { cmd: string[]; useShell: boolean } {
  const trimmed = command.trim()
  
  // Already has shell execution flag
  if (needsShellExecution(trimmed)) {
    return { cmd: [shell, "-c", trimmed], useShell: true }
  }
  
  // Check for path separators (absolute or relative path)
  const hasPathSep = /[/\\]/.test(trimmed)
  if (hasPathSep) {
    return { cmd: [trimmed], useShell: false }
  }
  
  // Check for file extension
  const hasExtension = /\.(exe|cmd|bat|com|ps1|sh)$/i.test(trimmed)
  if (hasExtension) {
    return { cmd: [trimmed], useShell: false }
  }
  
  // For Windows, try to find the executable using Bun.which
  const resolvedPath = Bun.which(trimmed)
  if (resolvedPath) {
    return { cmd: [resolvedPath], useShell: false }
  }
  
  // If not found, use shell execution
  return { cmd: [shell, "-c", trimmed], useShell: true }
}
```

---

## File Changes Summary

### File: `packages/opencode/src/tool/bash.ts`

| Section | Change | Priority | Details |
|---------|--------|----------|---------|
| Imports | Add `shell` from `../shell/shell` | HIGH | Already imported at line 14 |
| Line 20-50 | Add shell built-in detection functions | HIGH | New utility functions for command analysis |
| Line 154-160 | Update spawn to use resolved command | HIGH | Call `resolveWindowsCommand()` |
| Line 172-182 | Update `append` function | HIGH | Handle Buffer, Uint8Array, and string |
| Line 184-200 | Replace event-based with stream reader | HIGH | Use `.getReader()` approach |
| Line 210-227 | Update exit handling | MEDIUM | Simplify to use `proc.exited` |

### File: `packages/opencode/src/shell/shell.ts`

| Section | Change | Priority | Details |
|---------|--------|----------|---------|
| Line 40-56 | Enhance shell detection | LOW | Already working correctly |

---

## Complete Updated bash.ts Snippet (Lines 150-250)

```typescript
// Line 150: Command resolution for Windows
const { cmd, useShell } = resolveWindowsCommand(params.command)

// Line 153-161: Spawn with resolved command
const proc = Bun.spawn(cmd, {
  shell: useShell ? shell : undefined,
  cwd,
  env: buildGitEnv(),
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
})

// Line 163-180: Updated append function
const append = (chunk: Buffer | Uint8Array | string) => {
  const text = chunk instanceof Buffer || chunk instanceof Uint8Array 
    ? new TextDecoder().decode(chunk) 
    : chunk
  if (output.length <= MAX_OUTPUT_LENGTH) {
    output += text
    ctx.metadata({
      metadata: {
        output,
        description: params.description,
      },
    })
  }
}

// Line 182-200: Stream reader approach
const stdoutReader = proc.stdout?.getReader()
const stderrReader = proc.stderr?.getReader()

const readOutput = async (reader: ReadableStreamDefaultReader | undefined): Promise<void> => {
  if (!reader) return
  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<{ done: true }>((_, reject) => {
          ctx.abort.addEventListener("abort", () => reject(new Error("Aborted")), { once: true })
        })
      ])
      if (done) break
      append(value)
    }
  } catch (_e) {
    // Stream reading ended or was aborted
  }
}

// Concurrent stream reading
const [stdoutResult, stderrResult] = await Promise.all([
  readOutput(stdoutReader),
  readOutput(stderrReader),
  proc.exited,
])
```

---

## Testing Plan

### Test Scenarios

#### Type A - stdout handling
- [ ] `git status` - Should output git status info
- [ ] `tasklist` - Should list processes
- [ ] `ipconfig` - Should show IP configuration
- [ ] `dir` - Should list directory contents

#### Type B - Shell built-ins
- [ ] `echo test` - Should print "test"
- [ ] `pwd` - Should print current directory
- [ ] `cd /tmp && pwd` - Should change directory
- [ ] `type file.txt` - Should show file contents
- [ ] `which git` - Should show git path

#### Type C - Path resolution
- [ ] `notepad` - Should open notepad
- [ ] `calc` - Should open calculator
- [ ] `%USERPROFILE%` - Should expand environment variable

#### Mixed commands
- [ ] `echo hello && git status` - Should execute both
- [ ] `cd /c && ls -la` - Should change drive and list

### Test Commands

```bash
# Run existing bash tests
bun test packages/opencode/test/tool/bash.test.ts

# Manual testing on Windows
pnpm exec opencode
> echo "test"
> git status
> tasklist
> ipconfig
```

---

## Implementation Sequence

1. **Update bash.ts stdout handling** - Replace event-based with stream reader
2. **Update bash.ts spawn pattern** - Ensure consistent with prompt.ts
3. **Add shell built-in detection** - Wrap built-ins appropriately
4. **Run existing tests** - Verify no regressions
5. **Manual testing on Windows** - Verify fix for all three error types

---

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Breaking change to stdout handling | MEDIUM | Test thoroughly, add type guards |
| Shell built-in detection incomplete | LOW | Start with common built-ins, expand as needed |
| Windows path resolution edge cases | MEDIUM | Test with variety of commands |

---

## References

- Bun.spawn API: https://bun.sh/docs/api/spawn
- Node.js child_process: https://nodejs.org/api/child_process.html
- GitHub Issue #6488: https://github.com/anomalyco/opencode/issues/6488
