# Shell Detection Feasibility Research

## Context

Current implementation in `packages/opencode/src/shell/shell.ts` (lines 41-69) uses fallback logic that:

1. Checks `Flag.OPENCODE_GIT_BASH_PATH` on Windows
2. Derives bash.exe path from git.exe location
3. Falls back to `process.env.COMSPEC` or "cmd.exe"

**Problem**: Cannot distinguish shell type (PowerShell vs CMD vs Git Bash) - only finds executable path.

**Goal**: Detect shell type as: `'bash' | 'powershell' | 'cmd' | null`

---

## Detection Approaches

### Approach 1: Environment Variable Detection

**Strategy**: Check for shell-specific environment variables.

```typescript
export function detectShellType(): ShellType | null {
  if (process.platform !== "win32") return null

  // PowerShell-specific variables
  if (process.env.PSModulePath) return "powershell"
  if (process.env.PSExecutionPolicyPreference) return "powershell"

  // CMD-specific variable
  if (process.env.COMSPEC && process.env.COMSPEC.toLowerCase().includes("cmd.exe")) return "cmd"

  // Git Bash/MSYS2 might set MSYSTEM
  if (process.env.MSYSTEM) return "bash"

  return null
}

type ShellType = "bash" | "powershell" | "cmd" | null
```

**Pros**:

- Fast - no file system operations
- Reliable - env vars are guaranteed by shell initialization
- Zero overhead

**Cons**:

- Might not work if shells are launched programmatically (not via normal shell)
- Environment variables could be inherited from parent process
- Doesn't work for detection-only scenarios (no shell running)

**Reliability**: ⭐⭐⭐⭐ (4/5) - Very reliable for detecting CURRENT shell context

---

### Approach 2: Executable Path Validation

**Strategy**: Check if shell executables exist and validate their paths.

```typescript
import { which } from "@/util/which"
import path from "path"

export function detectShellTypeFromPath(): ShellType | null {
  if (process.platform !== "win32") return null

  // Check PowerShell (Core)
  const pwsh = which("pwsh.exe")
  if (pwsh && Filesystem.stat(pwsh)?.size) return "powershell"

  // Check Windows PowerShell (legacy)
  const powershell = which("powershell.exe")
  if (powershell && Filesystem.stat(powershell)?.size) return "powershell"

  // Check Git Bash
  const bash = which("bash.exe")
  if (bash && Filesystem.stat(bash)?.size) {
    // Additional validation: verify it's in Git installation
    const normalized = bash.toLowerCase()
    if (normalized.includes("git") || normalized.includes("\\bin\\bash.exe")) {
      return "bash"
    }
  }

  // Check CMD (always present on Windows)
  const comspec = process.env.COMSPEC || "cmd.exe"
  if (Filesystem.stat(comspec)?.size) return "cmd"

  return null
}
```

**Pros**:

- Works regardless of current shell context
- Validates executables actually exist
- Can detect shells even if not currently active

**Cons**:

- Requires file system operations (stat checks)
- Multiple path checks (slower)
- Which() might return partial paths

**Reliability**: ⭐⭐⭐⭐ (4/5) - Very reliable for availability detection

---

### Approach 3: Process Parent Inspection

**Strategy**: Inspect parent process to determine what launched the current process.

```typescript
import { spawn } from "child_process"

interface ProcessInfo {
  name: string
  executablePath: string
  commandLine: string
}

async function getParentProcess(pid: number): Promise<ProcessInfo | null> {
  try {
    const wmic = spawn("wmic", [
      "process",
      "where",
      `ProcessId=${pid}`,
      "get",
      "Name,ExecutablePath,CommandLine",
      "/format:csv",
    ])

    let output = ""
    wmic.stdout.on("data", (data) => (output += data.toString()))

    return new Promise((resolve) => {
      wmic.on("close", () => {
        const lines = output.trim().split("\n")
        if (lines.length < 2) return resolve(null)

        const parts = lines[1].split(",")
        resolve({
          name: parts[1]?.trim() || "",
          executablePath: parts[2]?.trim() || "",
          commandLine: parts[3]?.trim() || "",
        })
      })
    })
  } catch {
    return null
  }
}

export async function detectShellTypeFromParent(): Promise<ShellType | null> {
  if (process.platform !== "win32") return null

  const parent = await getParentProcess(process.ppid)
  if (!parent) return null

  const exe = parent.executablePath.toLowerCase()
  const name = parent.name.toLowerCase()

  if (exe.includes("pwsh.exe") || name === "pwsh.exe") return "powershell"
  if (exe.includes("powershell.exe") || name === "powershell.exe") return "powershell"
  if (exe.includes("bash.exe") || name === "bash.exe") return "bash"
  if (exe.includes("cmd.exe") || name === "cmd.exe") return "cmd"

  return null
}
```

**Pros**:

- Most accurate - detects actual shell context
- Works for inherited processes (detects user's terminal)
- No guessing - definitive parent process inspection

**Cons**:

- Async operation (slower)
- Requires spawning WMIC process (heavy)
- Might not work if parent is not a shell (e.g., launched by IDE)
- Windows-only (platform-specific API)

**Reliability**: ⭐⭐⭐⭐⭐ (5/5) - Most accurate for actual shell context

---

### Approach 4: Hybrid / Fallback Chain

**Strategy**: Combine multiple approaches in priority order.

```typescript
export async function detectShellType(): Promise<ShellType | null> {
  if (process.platform !== "win32") return null

  // Priority 1: Environment variables (fastest, most reliable for current shell)
  const envResult = detectFromEnvVars()
  if (envResult) return envResult

  // Priority 2: Process parent inspection (most accurate)
  const parentResult = await detectFromParentProcess()
  if (parentResult) return parentResult

  // Priority 3: Executable path validation (fallback for availability)
  const pathResult = detectFromExecutablePath()
  if (pathResult) return pathResult

  return null
}

function detectFromEnvVars(): ShellType | null {
  // Same as Approach 1
  if (process.env.PSModulePath) return "powershell"
  if (process.env.COMSPEC?.toLowerCase().includes("cmd.exe")) return "cmd"
  if (process.env.MSYSTEM) return "bash"
  return null
}

async function detectFromParentProcess(): Promise<ShellType | null> {
  // Same as Approach 3
  // Returns null if not a shell or detection fails
}

function detectFromExecutablePath(): ShellType | null {
  // Same as Approach 2
  // Returns null if nothing found
}
```

**Pros**:

- Maximizes reliability through multiple detection methods
- Graceful degradation (falls back if one method fails)
- Fast path for common cases (env vars)
- Comprehensive coverage

**Cons**:

- More complex implementation
- Async due to parent process inspection
- Still might fail in edge cases

**Reliability**: ⭐⭐⭐⭐⭐ (5/5) - Highest reliability through redundancy

---

## Comparison Matrix

| Approach              | Speed      | Accuracy   | Complexity | Windows-Only | Shell-Context Only |
| --------------------- | ---------- | ---------- | ---------- | ------------ | ------------------ |
| Environment Variables | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐   | Low        | No           | Yes                |
| Executable Path       | ⚡⚡⚡     | ⭐⭐⭐⭐   | Medium     | Partial      | No                 |
| Process Parent        | ⚡         | ⭐⭐⭐⭐⭐ | High       | Yes          | No                 |
| Hybrid                | ⚡⚡⚡     | ⭐⭐⭐⭐⭐ | High       | Partial      | No                 |

---

## Recommended Approach

### Primary Recommendation: Hybrid Approach (Approach 4)

**Rationale**:

1. **Maximum Reliability**: Combines all three detection methods, falling back gracefully
2. **Performance**: Fast path for common case (environment variables), async only when needed
3. **Comprehensive**: Works for both "current shell context" and "shell availability" scenarios
4. **Future-Proof**: Easy to extend with additional detection methods

**Implementation Strategy**:

```typescript
// packages/opencode/src/shell/shell.ts

export type ShellType = "bash" | "powershell" | "cmd" | null

export async function detectShellType(): Promise<ShellType> {
  if (process.platform !== "win32") return null

  // Fast path: environment variables
  const fromEnv = detectFromEnvVars()
  if (fromEnv) return fromEnv

  // Accurate: parent process inspection
  const fromParent = await detectFromParentProcess()
  if (fromParent) return fromParent

  // Fallback: executable paths
  const fromPath = detectFromExecutablePath()
  return fromPath
}

function detectFromEnvVars(): ShellType {
  if (process.env.PSModulePath) return "powershell"
  if (process.env.MSYSTEM) return "bash"
  if (process.env.COMSPEC?.toLowerCase().includes("cmd.exe")) return "cmd"
  return null
}

async function detectFromParentProcess(): Promise<ShellType> {
  // WMIC-based implementation from Approach 3
  // Returns null if parent is not a shell
}

function detectFromExecutablePath(): ShellType {
  // which() + Filesystem.stat() from Approach 2
  // Returns null if nothing found
}
```

### Alternative: Lightweight Variant

If async operation and WMIC dependency are concerns, use a **synchronous hybrid**:

```typescript
export function detectShellTypeSync(): ShellType {
  if (process.platform !== "win32") return null

  // Environment variables
  if (process.env.PSModulePath) return "powershell"
  if (process.env.MSYSTEM) return "bash"
  if (process.env.COMSPEC?.toLowerCase().includes("cmd.exe")) return "cmd"

  // Executable paths (no async, no parent process)
  if (which("pwsh.exe") || which("powershell.exe")) return "powershell"
  if (which("bash.exe")) return "bash"
  if (Filesystem.stat(process.env.COMSPEC || "cmd.exe")?.size) return "cmd"

  return null
}
```

**Trade-off**: 90% reliability for 0% async overhead. Good for simple detection, misses shell context.

---

## Integration with Existing Code

### Current `Shell.acceptable()` Enhancement

The current implementation (lines 65-69) returns shell path but doesn't detect type:

```typescript
export const acceptable = lazy(() => {
  const s = process.env.SHELL
  if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
  return fallback()
})
```

**Proposed Enhancement**:

```typescript
// Add new export for shell type detection
export const shellType = lazy(async () => await detectShellType())

// Keep existing acceptable() for backward compatibility
// But enhance it to use shellType for better default selection
export const acceptable = lazy(async () => {
  const s = process.env.SHELL
  if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s

  // NEW: Use detected shell type to make better fallback decision
  const type = await shellType()
  if (type === "powershell") {
    // Prefer PowerShell if available
    const pwsh = which("pwsh.exe") || which("powershell.exe")
    if (pwsh) return pwsh
  }

  return fallback()
})
```

---

## Edge Cases & Considerations

### Case 1: OpenCode Launched from IDE

- **Scenario**: OpenCode started from VS Code, IntelliJ, etc.
- **Detection**: Parent process is IDE, not shell
- **Solution**: Hybrid approach falls back to env vars or executable paths
- **Result**: Detects available shells, not necessarily the user's preferred shell

### Case 2: Multiple Shells Installed

- **Scenario**: User has PowerShell 5, PowerShell 7, Git Bash all installed
- **Detection**: Which approach takes precedence?
- **Solution**: Hybrid approach priority order (env > parent > path)
- **Result**: Detects most relevant shell based on context

### Case 3: Shells Without Environment Signatures

- **Scenario**: PowerShell launched via Start-Process (no env vars)
- **Detection**: Parent process inspection catches it
- **Solution**: Hybrid approach succeeds where env-only fails

### Case 4: Cross-Platform

- **Scenario**: Code runs on macOS/Linux
- **Detection**: Early return `null` - Windows detection only
- **Solution**: No-op on non-Windows, backward compatible

---

## Validation Scenarios

The following scenarios should pass once implemented:

| Scenario                | Expected Detection      | Method Used              |
| ----------------------- | ----------------------- | ------------------------ |
| PowerShell 7 terminal   | "powershell"            | Env var + parent process |
| PowerShell 5 terminal   | "powershell"            | Env var + parent process |
| CMD terminal            | "cmd"                   | COMSPEC env var + parent |
| Git Bash terminal       | "bash"                  | MSYSTEM env var + parent |
| Launched from IDE       | null or available shell | Executable path fallback |
| No shell (cron/service) | null                    | All methods return null  |

---

## Next Steps

1. **Implement hybrid approach** in `packages/opencode/src/shell/shell.ts`
2. **Add unit tests** for each detection method
3. **Add integration tests** for all validation scenarios
4. **Update documentation** with new `detectShellType()` API
5. **Consider adding `preferredShell()`** helper that uses detected type

---

## References

- Windows Environment Variables: [Microsoft Docs](https://learn.microsoft.com/en-us/windows/win32/procthread/environment-variables)
- WMIC Process Query: [Microsoft Docs](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmic)
- Node.js child_process: [Node.js Docs](https://nodejs.org/api/child_process.html)
- PowerShell Core Installation: [GitHub](https://github.com/PowerShell/PowerShell)
