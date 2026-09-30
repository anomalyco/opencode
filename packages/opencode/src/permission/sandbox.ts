import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"

// Real OS-level sandbox for shell commands, with honest availability: the
// mode is only ever claimed when a mechanism exists and probes successfully.
// Windows has no supported unprivileged mechanism, so it reports unavailable
// and permission rules that request a sandbox fall back to confirmation.

export type Mechanism = "bubblewrap" | "seatbelt" | "none"

export interface Availability {
  readonly mechanism: Mechanism
  // Binary that provides the mechanism when it is available.
  readonly path?: string
  // Why the environment cannot enforce a sandbox when mechanism is "none".
  readonly reason?: string
}

let cached: Availability | undefined

export function availability(): Availability {
  if (cached) return cached
  cached = detect()
  return cached
}

function detect(): Availability {
  if (process.platform === "win32") {
    return {
      mechanism: "none",
      reason: "Windows has no supported unprivileged sandbox mechanism (AppContainer requires an application manifest)",
    }
  }
  if (process.platform === "linux") {
    const bin = Bun.which("bwrap")
    if (!bin) return { mechanism: "none", reason: "bubblewrap (bwrap) is not installed" }
    const probe = Bun.spawnSync([bin, "--ro-bind", "/", "/", "--die-with-parent", "--", "/bin/true"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    if (probe.exitCode !== 0)
      return { mechanism: "none", reason: "bubblewrap failed its probe (are user namespaces restricted?)" }
    return { mechanism: "bubblewrap", path: bin }
  }
  if (process.platform === "darwin") {
    const bin = Bun.which("sandbox-exec")
    if (!bin) return { mechanism: "none", reason: "sandbox-exec is not available" }
    const probe = Bun.spawnSync([bin, "-p", "(version 1)(allow default)", "/usr/bin/true"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    if (probe.exitCode !== 0) return { mechanism: "none", reason: "sandbox-exec failed its probe" }
    return { mechanism: "seatbelt", path: bin }
  }
  return { mechanism: "none", reason: `unsupported platform "${process.platform}"` }
}

export type Verdict = "sandbox" | "restricted-network" | "allow" | "ask" | "deny"

const NETWORK_TOOLS = new Set(["webfetch", "websearch", "browser"])
const LOCAL_TOOLS = new Set([
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "lsp",
  "todowrite",
  "question",
  "external_directory",
  "skill",
  "doom_loop",
])

// Resolve a sandbox-flavoured rule action against the operation and the
// current environment. "ask" means the mode cannot be enforced here: the
// caller must confirm explicitly and never pretend isolation happened.
export function resolve(action: "sandbox" | "restricted-network", permission: string): Verdict {
  if (action === "restricted-network") {
    if (NETWORK_TOOLS.has(permission)) return "deny"
    if (permission === ShellID.ToolID) return availability().mechanism === "none" ? "ask" : "restricted-network"
    if (LOCAL_TOOLS.has(permission)) return "allow"
    // Subagents, MCP tools, and other unknown operations may reach the network.
    return "ask"
  }
  if (permission === ShellID.ToolID) return availability().mechanism === "none" ? "ask" : "sandbox"
  // File, todo, and question tools run inside this process where no OS
  // sandbox can be applied — never claim isolation we cannot provide.
  return "ask"
}

export interface Spawn {
  readonly command: string
  readonly args: string[]
}

interface WrapInput {
  shell: string
  command: string
  cwd: string
  workspace: string
  worktree: string
  network: boolean
}

// Build the sandboxed spawn for a shell command, or undefined when the
// environment has no mechanism. Pure apart from reading TMPDIR; pass an
// explicit availability to make the outcome deterministic in tests.
export function wrap(input: WrapInput, env: Availability = availability()): Spawn | undefined {
  if (env.mechanism === "bubblewrap" && env.path) return bubblewrap(env.path, input)
  if (env.mechanism === "seatbelt" && env.path) return seatbelt(env.path, input)
  return undefined
}

// Directories the command may write to: the workspace, the git worktree when
// it lives elsewhere, and the working directory when it sits outside both.
function bindRoots(input: WrapInput): string[] {
  const roots = [input.workspace]
  if (input.worktree !== "/" && !FSUtil.contains(input.workspace, input.worktree)) roots.push(input.worktree)
  if (!roots.some((root) => FSUtil.contains(root, input.cwd))) roots.push(input.cwd)
  return roots
}

function bubblewrap(bin: string, input: WrapInput): Spawn {
  return {
    command: bin,
    args: [
      "--ro-bind",
      "/",
      "/",
      ...bindRoots(input).flatMap((root) => ["--bind", root, root]),
      "--tmpfs",
      "/tmp",
      "--dev",
      "/dev",
      ...(input.network ? [] : ["--unshare-net"]),
      "--die-with-parent",
      "--",
      input.shell,
      "-c",
      input.command,
    ],
  }
}

// Seatbelt profile: reads stay open, writes are confined to the workspace
// roots and temp locations, and the network can be cut off per call.
function seatbelt(bin: string, input: WrapInput): Spawn {
  const quote = (value: string) => `"${value.replace(/\\/g, "/").replace(/"/g, '\\"')}"`
  const tmp = process.env.TMPDIR ?? "/tmp"
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    ...bindRoots(input).map((root) => `(allow file-write* (subpath ${quote(root)}))`),
    `(allow file-write* (subpath ${quote(tmp)}))`,
    '(allow file-write* (regex #"^/dev/"))',
    ...(input.network ? [] : ["(deny network*)"]),
  ].join("")
  return { command: bin, args: ["-p", profile, input.shell, "-c", input.command] }
}

export * as Sandbox from "./sandbox"
