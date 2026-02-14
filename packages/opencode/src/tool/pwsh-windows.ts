// Windows-specific PowerShell security checks.
// Gated behind process.platform === "win32" at the call site.
// Each check returns a Decision: "block" (hard deny), "ask" (require user
// confirmation), or "allow" (continue normally).

import { Log } from "../util/log"

const log = Log.create({ service: "pwsh-windows" })

export type Decision = { action: "block" | "ask" | "allow"; reason?: string }

const ALLOW: Decision = { action: "allow" }

function block(reason: string): Decision {
  return { action: "block", reason }
}

function ask(reason: string): Decision {
  return { action: "ask", reason }
}

// ─── Bypass Techniques ───────────────────────────────────────────────

// PowerShell parameter prefix matching: -EncodedCommand, -Enc, -En, -E
// all resolve to the same parameter. We match the minimum unambiguous prefix.
const ENCODED_CMD_RE =
  /(?:^|\s)(?:pwsh|powershell)(?:\.exe)?\s+.*-e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:nd?)?)?)?)?)?)?)?)?)?)?)?)?(?:[\s:=]|$)/i
const EXEC_POLICY_FLAG_RE =
  /(?:^|\s)(?:pwsh|powershell)(?:\.exe)?\s+.*-e(?:x(?:e(?:c(?:u(?:t(?:i(?:o(?:n(?:p(?:o(?:l(?:i(?:cy?)?)?)?)?)?)?)?)?)?)?)?)?)?(?:[\s:=]|$)/i
const SET_EXEC_POLICY_RE = /(?:^|\s)set-executionpolicy\s/i

// Download-and-execute: pipeline form or subexpression form
const DOWNLOAD_PIPE_IEX_RE =
  /(?:invoke-webrequest|invoke-restmethod|iwr|irm|new-object\s+net\.webclient|\[net\.webclient\]|\.downloadstring\().*\|\s*(?:invoke-expression|iex)/i
const IEX_SUBEXPR_DOWNLOAD_RE =
  /(?:iex|invoke-expression)\s*\(.*(?:invoke-webrequest|invoke-restmethod|iwr|irm|new-object\s+net\.webclient|\[net\.webclient\]|\.downloadstring)/i
const SCRIPTBLOCK_DOWNLOAD_RE =
  /\[scriptblock\]::create\(.*(?:invoke-webrequest|invoke-restmethod|iwr|irm|new-object\s+net\.webclient|\[net\.webclient\]|\.downloadstring)/i

// Hidden window: ProcessWindowStyle Hidden=1; saps is a built-in alias for Start-Process
const HIDDEN_WINDOW_RE = /(?:start-process|saps)\s.*-windowstyle\s+(?:hidden|1)(?:\s|$)/i

// Add-Type / .NET assembly loading
const ADD_TYPE_RE = /(?:^|\s)add-type\s/i
const ASSEMBLY_LOAD_RE = /\[system\.reflection\.assembly\]::load/i

// Remoting
const REMOTING_CMDLETS_RE = /(?:enter-pssession|invoke-command|new-pssession)\s.*-(?:computername|session)\s/i
const ENABLE_REMOTING_RE = /(?:^|\s)enable-psremoting/i
const WINRM_RE = /(?:^|\s)(?:winrm|winrs)(?:\s|$)/i

// Scheduled tasks
const SCHTASK_CMDLET_RE = /(?:^|\s)(?:register-scheduledtask|new-scheduledtasktrigger)\s/i
const SCHTASK_CMD_RE = /schtasks\s+\/create/i

// AMSI bypass
const AMSI_RE = /amsiutils|amsiinitfailed/i

// Strip colon/equal parameter binding: -Flag:Value or -Flag=Value → -Flag
function bareFlag(token: string): string {
  const idx = token.indexOf(":")
  const eq = token.indexOf("=")
  const sep = idx >= 0 && eq >= 0 ? Math.min(idx, eq) : idx >= 0 ? idx : eq
  if (sep > 1 && token.startsWith("-")) return token.slice(0, sep)
  return token
}

export function bypass(command: string): Decision {
  // Encoded command
  if (ENCODED_CMD_RE.test(command)) {
    // Disambiguate: -e could match -ExecutionPolicy. Check that it isn't followed by 'x'.
    // The ENCODED_CMD_RE is specific to -e/-en/-enc patterns.
    // But we also need to make sure this isn't a false match with -ExecutionPolicy.
    // So check the actual token after the binary.
    const tokens = command.split(/\s+/)
    for (let i = 0; i < tokens.length; i++) {
      const flag = bareFlag(tokens[i])
      if (/^-e(n(c(o(d(e(d(c(o(m(m(a(nd?)?)?)?)?)?)?)?)?)?)?)?)?$/i.test(flag) && !/^-ex/i.test(flag)) {
        const prev = tokens.slice(0, i).join(" ").toLowerCase()
        if (prev.includes("pwsh") || prev.includes("powershell")) {
          log.warn("Blocked encoded command", { command })
          return block("Encoded commands (-EncodedCommand) are blocked")
        }
      }
    }
  }

  // Execution policy bypass
  if (SET_EXEC_POLICY_RE.test(command)) {
    log.warn("Blocked Set-ExecutionPolicy", { command })
    return block("Set-ExecutionPolicy is blocked")
  }
  if (EXEC_POLICY_FLAG_RE.test(command)) {
    const tokens = command.split(/\s+/)
    for (let i = 0; i < tokens.length; i++) {
      const flag = bareFlag(tokens[i])
      if (/^-ex(e(c(u(t(i(o(n(p(o(l(i(cy?)?)?)?)?)?)?)?)?)?)?)?)?$/i.test(flag)) {
        const prev = tokens.slice(0, i).join(" ").toLowerCase()
        if (prev.includes("pwsh") || prev.includes("powershell")) {
          log.warn("Blocked -ExecutionPolicy flag", { command })
          return block("Execution policy modification is blocked")
        }
      }
    }
  }

  // Download and execute
  if (DOWNLOAD_PIPE_IEX_RE.test(command)) {
    log.warn("Blocked download-and-execute pipeline", { command })
    return block("Download-and-execute pattern is blocked")
  }
  if (IEX_SUBEXPR_DOWNLOAD_RE.test(command)) {
    log.warn("Blocked download-and-execute subexpression", { command })
    return block("Download-and-execute pattern is blocked")
  }
  if (SCRIPTBLOCK_DOWNLOAD_RE.test(command)) {
    log.warn("Blocked scriptblock from download", { command })
    return block("Download-and-execute pattern is blocked")
  }

  // Hidden window
  if (HIDDEN_WINDOW_RE.test(command)) {
    log.warn("Blocked hidden window execution", { command })
    return block("Hidden window execution (-WindowStyle Hidden) is blocked")
  }

  // Remoting
  if (REMOTING_CMDLETS_RE.test(command)) {
    log.warn("Blocked PowerShell remoting", { command })
    return block("PowerShell remoting is blocked")
  }
  if (ENABLE_REMOTING_RE.test(command)) {
    log.warn("Blocked Enable-PSRemoting", { command })
    return block("PowerShell remoting is blocked")
  }
  if (WINRM_RE.test(command)) {
    log.warn("Blocked winrm/winrs", { command })
    return block("WinRM/WinRS is blocked")
  }

  // Scheduled tasks
  if (SCHTASK_CMDLET_RE.test(command)) {
    log.warn("Blocked scheduled task creation", { command })
    return block("Scheduled task creation is blocked")
  }
  if (SCHTASK_CMD_RE.test(command)) {
    log.warn("Blocked schtasks /create", { command })
    return block("Scheduled task creation is blocked")
  }

  // AMSI bypass
  if (AMSI_RE.test(command)) {
    log.warn("Blocked AMSI bypass attempt", { command })
    return block("AMSI bypass is blocked")
  }

  // Add-Type / assembly loading (ASK, not BLOCK)
  if (ADD_TYPE_RE.test(command)) {
    return ask("Add-Type loads arbitrary .NET code")
  }
  if (ASSEMBLY_LOAD_RE.test(command)) {
    return ask("Assembly loading detected")
  }

  return ALLOW
}

// ─── cmd.exe Pattern Detection ───────────────────────────────────────

// Detect cmd.exe invocation and extract inner command
const CMD_INVOKE_RE = /(?:^|\s|&\s*)(?:cmd|cmd\.exe)\s/i
const CMD_START_PROCESS_RE = /(?:start-process|saps)\s+(?:cmd|cmd\.exe)\s/i

function extractCmdPayload(command: string): string | null {
  // Direct cmd /c or /k invocation
  const directMatch = command.match(/(?:cmd|cmd\.exe)\s+(?:\/[a-z]\s+)*\/[ck]\s+(.+)/i)
  if (directMatch) return directMatch[1].replace(/^["']|["']$/g, "")

  // Start-Process cmd -ArgumentList form (also matches saps alias)
  const startMatch = command.match(/(?:start-process|saps)\s+(?:cmd|cmd\.exe)\s+-argumentlist\s+(.+)/i)
  if (startMatch) {
    const args = startMatch[1]
    // Comma-separated form: '/c', 'actual command' or "/c", "actual command"
    const parts = args.split(/,\s*/).map((s) => s.replace(/^['"]|['"]$/g, "").trim())
    const ckIdx = parts.findIndex((p) => /^\/[ck]$/i.test(p))
    if (ckIdx >= 0 && ckIdx + 1 < parts.length) return parts.slice(ckIdx + 1).join(" ")
    // Single-string form: "/c rd /s /q C:\data" or '/c some command'
    if (parts.length === 1) {
      const single = parts[0].match(/^\/[ck]\s+(.+)/i)
      if (single) return single[1]
    }
  }

  return null
}

// Destructive cmd.exe patterns
const RD_RE = /(?:^|\s)(?:rd|rmdir)\s+\/s/i
const DEL_RE = /(?:^|\s)(?:del|erase)\s+\/[fs]/i
const FORMAT_RE = /(?:^|\s)format\s+[a-z]:/i
const DISKPART_RE = /(?:^|\s)diskpart(?:\s|$)/i
const BCDEDIT_RE = /(?:^|\s)bcdedit(?:\s|$)/i
const ICACLS_RE = /(?:^|\s)icacls\s.*\/grant\s/i
const TAKEOWN_RE = /(?:^|\s)takeown\s.*\/r/i
const ATTRIB_RE = /(?:^|\s)attrib\s.*-[rhs]/i

// cmd.exe registry commands
const REG_ADD_RE = /(?:^|\s)reg\s+add\s+/i
const REG_DELETE_FORCE_RE = /(?:^|\s)reg\s+delete\s+.*\/f/i
const REG_DELETE_RE = /(?:^|\s)reg\s+delete\s+/i
const REG_IMPORT_RE = /(?:^|\s)reg\s+import\s+/i

export function cmd(command: string): Decision {
  if (!CMD_INVOKE_RE.test(command) && !CMD_START_PROCESS_RE.test(command)) return ALLOW

  const payload = extractCmdPayload(command)
  if (payload === null) {
    // Could not parse the nested command — fail closed
    return ask("Unable to safely parse cmd.exe nested command")
  }

  // Check destructive patterns in the cmd payload
  if (RD_RE.test(payload) && /\/q/i.test(payload)) {
    return block("cmd.exe recursive directory delete with /q is blocked")
  }
  if (RD_RE.test(payload)) return ask("cmd.exe recursive directory delete (rd /s)")
  if (DEL_RE.test(payload)) return ask("cmd.exe force/recursive file delete")
  if (FORMAT_RE.test(payload)) return block("cmd.exe format command is blocked")
  if (DISKPART_RE.test(payload)) return block("cmd.exe diskpart is blocked")
  if (BCDEDIT_RE.test(payload)) return block("cmd.exe bcdedit is blocked")
  if (ICACLS_RE.test(payload)) return ask("cmd.exe permission manipulation (icacls)")
  if (TAKEOWN_RE.test(payload)) return ask("cmd.exe recursive ownership change (takeown)")
  if (ATTRIB_RE.test(payload)) return ask("cmd.exe attribute removal")

  // cmd.exe registry commands
  if (REG_DELETE_FORCE_RE.test(payload)) {
    const path = extractRegPathFromCmd(payload)
    if (path && isCriticalRegistryPath(path)) return block("cmd.exe force delete of critical registry path")
    return block("cmd.exe reg delete /f is blocked")
  }
  if (REG_ADD_RE.test(payload)) {
    const path = extractRegPathFromCmd(payload)
    if (path && isCriticalRegistryPath(path)) return block("cmd.exe write to critical registry path")
    return ask("cmd.exe registry add operation")
  }
  if (REG_DELETE_RE.test(payload)) {
    const path = extractRegPathFromCmd(payload)
    if (path && isCriticalRegistryPath(path)) return block("cmd.exe delete of critical registry path")
    return ask("cmd.exe registry delete operation")
  }
  if (REG_IMPORT_RE.test(payload)) return ask("cmd.exe bulk registry import")

  return ALLOW
}

function extractRegPathFromCmd(payload: string): string | null {
  const match = payload.match(/reg\s+(?:add|delete)\s+("?)((HK[A-Z_]+)[/\\][^\s"]+)\1/i)
  return match ? match[2].replace(/\//g, "\\") : null
}

// ─── Registry Protection ─────────────────────────────────────────────

const CRITICAL_REGISTRY_PATHS = [
  // Persistence / Autorun
  "software\\microsoft\\windows\\currentversion\\run",
  "software\\microsoft\\windows\\currentversion\\runonce",
  "software\\microsoft\\windows nt\\currentversion\\winlogon",
  // Security settings
  "software\\policies\\microsoft\\windows defender",
  "system\\currentcontrolset\\services\\sharedaccess\\parameters\\firewallpolicy",
  "software\\microsoft\\windows\\currentversion\\policies\\system",
  // Remote access
  "system\\currentcontrolset\\control\\terminal server",
  "software\\policies\\microsoft\\windows\\winrm",
]

function isCriticalRegistryPath(path: string): boolean {
  const normalized = path
    // Strip Registry::HKEY_* qualified form first
    .replace(/^Registry::HKEY_[A-Z_]+[/\\]/i, "")
    // Then strip drive-style HKCU:\ / HKLM:\ etc. and long-form HKEY_*
    .replace(
      /^(HKCU|HKLM|HKCR|HKU|HKCC|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE|HKEY_CLASSES_ROOT|HKEY_USERS|HKEY_CURRENT_CONFIG)[:/\\]+/i,
      "",
    )
    .replace(/\//g, "\\")
    .toLowerCase()
  return CRITICAL_REGISTRY_PATHS.some((critical) => normalized.startsWith(critical))
}

const WRITE_CMDLETS = new Set([
  "set-itemproperty",
  "new-itemproperty",
  "remove-itemproperty",
  "new-item",
  "remove-item",
  "set-item",
  "clear-item",
  "rename-item",
  // aliases
  "sp",
  "ni",
  "ri",
  "si",
  "rni",
])

// Registry provider names (lowercase) including short and qualified forms
const REGISTRY_PROVIDERS = new Set(["hkcu", "hklm", "hkcr", "hku", "hkcc", "registry"])

// Provider path detection: HKCU:\..., HKCU:/..., Registry::..., Cert:\..., WSMan:\..., Env:\...
const PROVIDER_DRIVE_RE = /^([A-Za-z]+):[/\\]/
const PROVIDER_QUALIFIED_RE = /^([A-Za-z]+)::/

function extractProvider(path: string): string | null {
  const driveMatch = path.match(PROVIDER_DRIVE_RE)
  if (driveMatch && driveMatch[1].length > 1) return driveMatch[1].toLowerCase()
  const qualifiedMatch = path.match(PROVIDER_QUALIFIED_RE)
  if (qualifiedMatch) return qualifiedMatch[1].toLowerCase()
  return null
}

export function registry(cmdletName: string, args: string[]): Decision {
  const nameLower = cmdletName.toLowerCase()
  const isWrite = WRITE_CMDLETS.has(nameLower)

  for (const arg of args) {
    if (arg.startsWith("-")) continue

    const provider = extractProvider(arg)
    if (!provider) continue

    // WSMan — always block
    if (provider === "wsman") {
      return block("WSMan provider access is blocked")
    }

    // Registry providers (HKCU, HKLM, HKCR, HKU, HKCC, and Registry:: qualified form)
    if (REGISTRY_PROVIDERS.has(provider)) {
      if (isCriticalRegistryPath(arg)) {
        if (isWrite) return block(`Write to critical registry path: ${arg}`)
        // Even reads of critical paths through non-dangerous cmdlets get ASK
        return ask(`Access to critical registry path: ${arg}`)
      }
      if (isWrite) return ask(`Registry modification: ${cmdletName} ${arg}`)
    }

    // Certificate store
    if (provider === "cert") {
      if (isWrite) return ask(`Certificate store modification: ${cmdletName} ${arg}`)
    }

    // Environment provider
    if (provider === "env") {
      if (isWrite) return ask(`Environment variable modification: ${cmdletName} ${arg}`)
    }
  }

  return ALLOW
}

// ─── Top-level Evaluator ─────────────────────────────────────────────

export function evaluate(command: string, cmdletName?: string, args?: string[]): Decision {
  // 1. Bypass techniques (hardest blocks first)
  const bypassResult = bypass(command)
  if (bypassResult.action !== "allow") return bypassResult

  // 2. cmd.exe unwrapping
  const cmdResult = cmd(command)
  if (cmdResult.action !== "allow") return cmdResult

  // 3. Registry and provider-path checks (need parsed cmdlet/args)
  if (cmdletName && args) {
    const regResult = registry(cmdletName, args)
    if (regResult.action !== "allow") return regResult
  }

  return ALLOW
}
