export * as Sandbox from "./sandbox.js"

import { existsSync, lstatSync, realpathSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Schema } from "effect"
import type { Entry } from "@opencode/schema/config"
import type { ConfigSandbox } from "@opencode/schema/config/sandbox"
import { which } from "./util/which.js"

/**
 * OS-level sandbox for agent shell commands. The command is wrapped, never reimplemented: bubblewrap on Linux and
 * sandbox-exec (Seatbelt) on macOS confine the shell and everything it starts. Nothing here runs a process or
 * touches the filesystem except to locate the backend and resolve symlinks, so the wrapping is plain data.
 *
 * Filesystem: everything is readable, and only the workspace (plus temporary directories) is writable, or nothing
 * with `read-only`. Network: denied unless the policy allows it. An enabled sandbox never falls back to running
 * the command unconfined.
 */

export interface Policy {
  readonly mode: ConfigSandbox.Mode
  readonly network: ConfigSandbox.Network
  /** Extra directories a `workspace-write` sandbox may write to. */
  readonly writableRoots?: readonly string[]
  /** Extra directories mounted read-only. */
  readonly readableRoots?: readonly string[]
}

export interface Command {
  readonly program: string
  readonly args: readonly string[]
}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Sandbox.UnavailableError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Sandbox is enabled but unavailable: ${this.reason}. The command was not run. Fix the sandbox, or set sandbox.enabled to false.`
  }
}

export interface WrapInput {
  readonly policy: Policy
  readonly command: Command
  readonly cwd: string
  /** The one directory a `workspace-write` sandbox may write to. */
  readonly workspace: string
  /** Remote workspaces run commands elsewhere, where this host's sandbox does not apply. */
  readonly remote?: boolean
  readonly platform?: NodeJS.Platform
  /** Finds an executable. Defaults to a PATH lookup. */
  readonly find?: (name: string) => string | undefined
}

/**
 * The sandbox settings of every config layer, lowest priority first, merged field by field. A layer that sets only
 * `network` cannot drop `enabled` from a lower layer, and the security settings are monotonic: once any layer
 * enables the sandbox, selects `"read-only"`, or denies the network, a later layer cannot loosen it. Only roots are
 * additive grants, because a project may legitimately need more writable directories.
 */
export function merge(entries: readonly Entry[]): ConfigSandbox.Info | undefined {
  const layers = entries.flatMap((entry) =>
    entry.type === "document" && entry.info.sandbox ? [entry.info.sandbox] : [],
  )
  if (layers.length === 0) return undefined
  const pick = <K extends keyof ConfigSandbox.Info>(key: K) =>
    layers.findLast((layer) => layer[key] !== undefined)?.[key]
  const roots = <K extends "writable_roots" | "readable_roots">(key: K) => {
    const all = layers.flatMap((layer) => layer[key] ?? [])
    return all.length === 0 ? undefined : [...new Set(all)]
  }
  const enabled = layers.some((layer) => layer.enabled === true) ? true : pick("enabled")
  const mode = layers.some((layer) => layer.mode === "read-only") ? "read-only" : pick("mode")
  const network = layers.some((layer) => layer.network === "deny") ? "deny" : pick("network")
  return {
    enabled,
    mode,
    network,
    writable_roots: roots("writable_roots"),
    readable_roots: roots("readable_roots"),
  } as ConfigSandbox.Info
}

// The policy a workspace runs under, fixed when it first asks for a command. Pinning it means a config file that a
// confined command creates or rewrites cannot change the policy of the running process: the sandbox settings of a
// workspace are read once, like a command-line flag, and changing them needs a restart. Without the pin, a
// workspace-write command could write an opencode.json that grants itself network access or extra roots on its next
// invocation.
const policies = new Map<string, Policy | undefined>()

/**
 * The policy for a workspace, pinned on first use. `entries` is read only when the workspace has no policy yet.
 */
export function policy(entries: readonly Entry[], workspace: string): Policy | undefined {
  const key = canonical(workspace)
  if (!policies.has(key)) policies.set(key, resolve(merge(entries)))
  return policies.get(key)
}

/** Test helper: forget every pinned workspace policy. */
export function resetPolicies() {
  policies.clear()
}

/**
 * Workspace paths a sandboxed command can never write, even in `workspace-write`: the files that configure the
 * sandbox. Otherwise a confined command could write `{"sandbox":{"enabled":false}}` and run unconfined next time.
 */
export const PROTECTED = ["opencode.json", "opencode.jsonc", ".opencode"] as const

/** The policy to enforce, or undefined when the sandbox is not enabled. Unset `network` takes the strictest value (deny); an unset `mode` takes the schema default `workspace-write`, which is NOT the strictest mode (`read-only` is). */
export function resolve(config: ConfigSandbox.Info | undefined): Policy | undefined {
  if (config?.enabled !== true) return undefined
  return {
    mode: config.mode ?? "workspace-write",
    network: config.network ?? "deny",
    ...(config.writable_roots?.length ? { writableRoots: config.writable_roots } : {}),
    ...(config.readable_roots?.length ? { readableRoots: config.readable_roots } : {}),
  }
}

export function wrap(input: WrapInput): Command | UnavailableError {
  const platform = input.platform ?? process.platform
  if (input.remote)
    return new UnavailableError({ reason: "the sandbox cannot confine commands that run in a remote workspace" })
  if (platform !== "linux" && platform !== "darwin")
    return new UnavailableError({ reason: `no sandbox backend exists for ${platform}` })
  const name = platform === "linux" ? "bwrap" : "sandbox-exec"
  const program = (input.find ?? find)(name)
  if (!program)
    return new UnavailableError({
      reason: `${name} was not found${platform === "linux" ? " (install bubblewrap)" : ""}`,
    })
  const workspace = canonical(input.workspace)
  const args = platform === "linux" ? bwrapArgs(input, workspace) : seatbeltArgs(input, workspace)
  return { program, args: [...args, "--", input.command.program, ...input.command.args] }
}

// Extra roots resolve against the workspace and are canonical, like the workspace itself.
function roots(list: readonly string[] | undefined, workspace: string) {
  return [...new Set((list ?? []).map((root) => canonical(path.resolve(workspace, root))))]
}

export function bwrapArgs(input: Pick<WrapInput, "policy" | "cwd">, workspace: string) {
  const writable = input.policy.mode === "workspace-write" ? roots(input.policy.writableRoots, workspace) : []
  const readable = roots(input.policy.readableRoots, workspace)
  // Binds go after the workspace bind so they stay read-only inside it. Only regular files and directories that
  // already exist are bound: bubblewrap has to create a mount point for a missing target, which would leave an
  // empty file in the workspace behind, and it refuses to mount on a symlink destination at all. An absent or
  // symlinked config path is workspace content a command may create or replace, like any other file.
  const protectedPaths =
    input.policy.mode === "workspace-write"
      ? // A writable root that does not exist is not mounted, so there is nothing in it to protect.
        [workspace, ...writable.filter((root) => existsSync(root))].flatMap((base) =>
          PROTECTED.flatMap((name) => {
            const target = path.join(base, name)
            const stat = lstatSync(target, { throwIfNoEntry: false })
            return stat && !stat.isSymbolicLink() ? ["--ro-bind", target, target] : []
          }),
        )
      : []
  return [
    "--die-with-parent",
    "--new-session",
    // Every namespace, including the network. `--share-net` below joins the host's again only when allowed.
    "--unshare-all",
    ...(input.policy.network === "allow" ? ["--share-net"] : []),
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    // Private and ephemeral, so even a read-only sandbox has scratch space that never reaches the host.
    "--tmpfs",
    "/tmp",
    // After the tmpfs, so a workspace under /tmp stays the real directory (writable in workspace-write mode,
    // read-only otherwise — either way it must still be the real directory and not the fresh tmpfs).
    ...readable.flatMap((root) => ["--ro-bind-try", root, root]),
    ...(input.policy.mode === "workspace-write"
      ? ["--bind", workspace, workspace]
      : ["--ro-bind-try", workspace, workspace]),
    ...writable.flatMap((root) => ["--bind-try", root, root]),
    ...protectedPaths,
    "--chdir",
    input.cwd,
  ]
}

// Directories are passed as `-D` parameters and read with `(param ...)`, so no path is ever spliced into the profile.
export function seatbeltProfile(policy: Policy) {
  const writable = policy.mode === "workspace-write" ? (policy.writableRoots ?? []) : []
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow process-info* (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
    "(allow user-preference-read)",
    "(allow pseudo-tty)",
    "(allow file-read*)",
    '(allow file-write* (literal "/dev/null") (literal "/dev/dtracehelper") (regex #"^/dev/tty"))',
    ...(policy.mode === "workspace-write"
      ? [
          '(allow file-write* (subpath (param "WORKSPACE")) (subpath (param "TMPDIR")) (subpath "/private/tmp"))',
          ...writable.map((_, index) => `(allow file-write* (subpath (param "WRITABLE_${index}")))`),
          // Last, so it wins: the files that configure the sandbox stay read-only inside every writable directory.
          ...["WORKSPACE", ...writable.map((_, index) => `WRITABLE_${index}`)].map(
            (param) =>
              `(deny file-write* ${PROTECTED.map((name) => `(subpath (string-append (param "${param}") "/${name}"))`).join(" ")})`,
          ),
        ]
      : []),
    ...(policy.network === "allow" ? ["(allow network*)"] : []),
  ].join("\n")
}

function seatbeltArgs(input: Pick<WrapInput, "policy">, workspace: string) {
  const writable = input.policy.mode === "workspace-write" ? roots(input.policy.writableRoots, workspace) : []
  return [
    "-p",
    // Indexes line up with the roots the profile refers to, which resolve here the same way.
    seatbeltProfile({ ...input.policy, writableRoots: writable }),
    "-D",
    `WORKSPACE=${workspace}`,
    "-D",
    `TMPDIR=${canonical(tmpdir())}`,
    ...writable.flatMap((root, index) => ["-D", `WRITABLE_${index}=${root}`]),
  ]
}

function canonical(directory: string) {
  // Seatbelt and bind mounts match real paths, so a symlinked workspace (macOS /var -> /private/var) must resolve.
  return existsSync(directory) ? realpathSync(directory) : directory
}

function find(name: string) {
  // macOS ships sandbox-exec at a fixed path; prefer it over whatever PATH holds.
  if (name === "sandbox-exec" && existsSync("/usr/bin/sandbox-exec")) return "/usr/bin/sandbox-exec"
  return which(name) ?? undefined
}
