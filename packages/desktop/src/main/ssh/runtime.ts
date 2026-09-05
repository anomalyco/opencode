import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { SshHostProbe } from "../../preload/types"
import { nativeT } from "../native-translations"
import {
  buildSshInstallScript,
  buildSshProbeScript,
  parseSshDestination,
  parseSshProbeOutput,
  sshRunArgs,
  windowsSshTerminalArgs,
  type SshDestination,
} from "./policy"

export type SshCommandLine = {
  stream: "stdout" | "stderr"
  text: string
}

export type SshCommandResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export type RunSshOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

const DEFAULT_SSH_TIMEOUT_MS = 60_000
const DEFAULT_SSH_INSTALL_TIMEOUT_MS = 15 * 60_000

export function resolveSshCommand() {
  if (process.platform !== "win32") return "ssh"
  const root = process.env.SystemRoot ?? process.env.windir
  if (!root) return "ssh"
  const resolved = join(root, "System32", "OpenSSH", "ssh.exe")
  return existsSync(resolved) ? resolved : "ssh"
}

export function requireSshDestination(host: string): SshDestination {
  const dest = parseSshDestination(host)
  if (!dest) throw new Error(nativeT("desktop.ssh.error.invalidHost", { host }))
  return dest
}

/**
 * Runs a script on the remote host through `ssh <dest> sh -se`, delivering the
 * script over stdin so no remote shell quoting is involved.
 */
export function runSshScript(dest: SshDestination, script: string, opts: RunSshOptions = {}) {
  return new Promise<SshCommandResult>((resolve, reject) => {
    const child = spawn(resolveSshCommand(), sshRunArgs(dest), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      signal: opts.signal,
    })
    child.stdin.on("error", () => {
      // The connection can drop before the script is fully written; the close
      // handler reports the failure.
    })
    child.stdin.end(script)

    const timeoutMs = opts.timeoutMs ?? DEFAULT_SSH_TIMEOUT_MS
    const timeoutId = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      reject(new Error(nativeT("desktop.ssh.error.commandTimeout", { host: dest.destination, timeout: timeoutMs })))
    }, timeoutMs)

    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })

    child.once("error", (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timeoutId)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

export async function probeSshHost(host: string, expectedVersion: string, opts?: RunSshOptions): Promise<SshHostProbe> {
  const dest = requireSshDestination(host)
  const result = await runSshScript(dest, buildSshProbeScript(), opts).catch(
    (error): SshCommandResult => ({
      code: 255,
      signal: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }),
  )
  const parsed = parseSshProbeOutput(result.stdout)
  if (!parsed.reachable) {
    return {
      host,
      reachable: false,
      opencodePath: null,
      opencodeVersion: null,
      expectedVersion,
      matchesDesktop: null,
      error: summarize(result.stderr) || nativeT("desktop.ssh.error.connectFailed", { host }),
    }
  }
  return {
    host,
    reachable: true,
    opencodePath: parsed.opencodePath,
    opencodeVersion: parsed.opencodeVersion,
    expectedVersion,
    matchesDesktop: parsed.opencodeVersion === null ? null : parsed.opencodeVersion === expectedVersion,
    error: null,
  }
}

export async function installSshOpencode(version: string, host: string, opts?: RunSshOptions) {
  const dest = requireSshDestination(host)
  return runSshScript(dest, buildSshInstallScript(version), {
    ...opts,
    timeoutMs: opts?.timeoutMs ?? DEFAULT_SSH_INSTALL_TIMEOUT_MS,
  })
}

export function openSshTerminal(host: string) {
  const dest = requireSshDestination(host)
  if (process.platform === "win32") {
    return spawnDetached("cmd.exe", windowsSshTerminalArgs(dest))
  }
  if (process.platform === "darwin") {
    const user = dest.user === null ? "" : `${dest.user}@`
    const hostname = dest.host.includes(":") ? `[${dest.host}]` : dest.host
    const port = dest.port === null ? "" : `:${dest.port}`
    return spawnDetached("open", [`ssh://${user}${hostname}${port}`])
  }
  return openLinuxSshTerminal(dest)
}

async function openLinuxSshTerminal(dest: SshDestination) {
  const ssh = ["ssh", ...(dest.port === null ? [] : ["-p", String(dest.port)]), dest.destination]
  const candidates: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", ...ssh]],
    ["gnome-terminal", ["--", ...ssh]],
    ["konsole", ["-e", ...ssh]],
    ["xfce4-terminal", ["-e", ssh.join(" ")]],
    ["xterm", ["-e", ...ssh]],
  ]
  for (const [command, args] of candidates) {
    const opened = await spawnDetached(command, args).then(
      () => true,
      () => false,
    )
    if (opened) return
  }
  throw new Error(nativeT("desktop.ssh.error.terminalFailed"))
}

function spawnDetached(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

export function summarize(value: string) {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}
