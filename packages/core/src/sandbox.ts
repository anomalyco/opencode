export * as Sandbox from "./sandbox.js"

import { realpathSync } from "node:fs"
import os from "os"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import type { ContainerRequest } from "@microsoft/mxc-sdk/v1"
import type { Document, Entry } from "@opencode/schema/config"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "./config.js"
import { Location } from "./location.js"
import { ShellSelect } from "./shell/select.js"

/** The pinned sandbox policy of a Location, resolved from user-level config only. */
export interface Policy {
  readonly mode: "read-only" | "workspace-write"
  readonly network: "deny" | "allow"
  readonly writableRoots: ReadonlyArray<string>
}

/** A command to run inside the sandbox; the service adds the workspace roots from the Location. */
export interface Execution {
  readonly command: string
  readonly cwd: string
  readonly shell: string
  readonly timeout: number
  readonly environment: Record<string, string | undefined>
}

export interface Result {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Sandbox.UnavailableError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Sandbox is enabled but unavailable: ${this.reason}. The command was not run. Fix the sandbox, or set sandbox.enabled to false.`
  }
}

// Workspace paths a sandboxed command must never write, even in workspace-write mode, whether or not they exist
// yet: planting a config, plugin or agent file would run unsandboxed code after a restart.
const PROTECTED = ["opencode.json", "opencode.jsonc", ".opencode", ".claude", ".agents"] as const

/**
 * Resolves the sandbox policy from config entries. Sandbox settings are a user-level security intent: documents
 * from inside the workspace, or from a directory the workspace was discovered from by walking up, are repository
 * content and are ignored, so a cloned repository cannot enable, loosen or tighten the sandbox.
 */
export function resolve(entries: readonly Entry[], workspace: string): Policy | undefined {
  const documents = entries
    .filter((entry): entry is Document => entry.type === "document")
    .filter((document) => trusted(document, workspace))
  if (!documents.some((document) => document.info.sandbox?.enabled === true)) return undefined
  let write = false
  let restricted = false
  let open = false
  let denied = false
  const roots = new Set<string>()
  for (const document of documents) {
    const sandbox = document.info.sandbox
    if (sandbox === undefined) continue
    if (sandbox.mode === "workspace-write") write = true
    if (sandbox.mode === "read-only") restricted = true
    if (sandbox.network === "allow") open = true
    if (sandbox.network === "deny") denied = true
    for (const root of sandbox.writable_roots ?? []) roots.add(path.resolve(workspace, root))
  }
  return {
    mode: write && !restricted ? "workspace-write" : "read-only",
    network: open && !denied ? "allow" : "deny",
    writableRoots: [...roots],
  }
}

// Config without a path (in-memory, remote account, managed content) is user-level by construction.
function trusted(document: Document, workspace: string) {
  if (document.path === undefined) return true
  const directory = path.dirname(document.path)
  if (directory === workspace || directory.startsWith(workspace + path.sep)) return false
  if (directory === path.parse(workspace).root) return false
  return !workspace.startsWith(directory + path.sep)
}

/** Maps the pinned policy and one execution onto an MXC container request. */
export function request(
  policy: Policy,
  input: Execution & { readonly workspace: string; readonly tmpRoots: ReadonlyArray<string> },
  platform: NodeJS.Platform = process.platform,
): ContainerRequest {
  const protectedPaths = PROTECTED.map((item) => path.join(input.workspace, item))
  return {
    command: commandLine(input.shell, input.command, platform),
    containment: { type: "process" },
    workingDirectory: input.cwd,
    timeoutMs: input.timeout,
    environment: input.environment,
    inheritDefaultEnvironment: true,
    ...(policy.mode === "workspace-write"
      ? {
          filesystem:
            platform === "win32"
              ? // The Windows backend does not enforce read-only carve-outs under writable roots, so protected
                // paths are denied outright instead; the in-process read tool still reads them.
                { readwritePaths: [input.workspace, ...input.tmpRoots, ...policy.writableRoots], deniedPaths: protectedPaths }
              : { readwritePaths: [input.workspace, ...input.tmpRoots, ...policy.writableRoots], readonlyPaths: protectedPaths },
        }
      : { filesystem: { readonlyPaths: [input.workspace] } }),
    network:
      policy.network === "deny"
        ? { egress: { default: "deny" }, ingress: { default: "deny", hostLoopback: "deny" } }
        : { egress: { default: "allow" } },
  }
}

/** Builds the single command line MXC parses, quoting the shell and its arguments for the platform. */
export const commandLine = (shell: string, command: string, platform: NodeJS.Platform = process.platform) =>
  [shell, ...ShellSelect.args(shell, command)]
    .map((argument) => (platform === "win32" ? windowsArgument(argument) : posixArgument(argument)))
    .join(" ")

const posixArgument = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

// The Windows command line is parsed with backslash and double-quote rules, not POSIX single quotes. cmd.exe
// also rejects quoted option arguments such as "/c", so plain tokens stay unquoted.
function windowsArgument(value: string) {
  if (!/[\s"]/.test(value)) return value
  let quoted = '"'
  let backslashes = 0
  for (const character of value) {
    if (character === "\\") {
      backslashes++
      continue
    }
    if (character === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
      continue
    }
    quoted += "\\".repeat(backslashes) + character
    backslashes = 0
  }
  return quoted + "\\".repeat(backslashes * 2) + '"'
}

export interface Interface {
  /** The sandbox policy of this Location, pinned on first use for the process lifetime, or undefined when off. */
  readonly policy: () => Effect.Effect<Policy | undefined>
  /** Runs one command inside the sandbox. Fails closed with `UnavailableError`; never runs a command unconfined. */
  readonly execute: (input: Execution) => Effect.Effect<Result, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Sandbox") {}

const layer = () =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const location = yield* Location.Service
      let pinned: Policy | undefined
      let resolved = false
      const policy = () =>
        Effect.gen(function* () {
          if (resolved) return pinned
          pinned = resolve(yield* config.entries(), location.directory)
          resolved = true
          return pinned
        })
      // The temp directory can be a symlink (macOS /var), and seatbelt matches real paths.
      const tmp = os.tmpdir()
      let real = tmp
      try {
        real = realpathSync(tmp)
      } catch {}
      const tmpRoots = real === tmp ? [tmp] : [tmp, real]
      const execute = Effect.fn("Sandbox.execute")(function* (input: Execution) {
        if (location.workspaceID !== undefined)
          return yield* new UnavailableError({ reason: "the workspace is remote" })
        const current = yield* policy()
        if (current === undefined) return yield* new UnavailableError({ reason: "the sandbox is not enabled" })
        const mxc = yield* Effect.tryPromise(() => import("@microsoft/mxc-sdk/v1")).pipe(
          Effect.mapError(
            (error) =>
              new UnavailableError({ reason: `the sandbox package failed to load: ${String(error.cause ?? error)}` }),
          ),
        )
        const support = mxc.getPlatformSupport()
        if (!support.isSupported)
          return yield* new UnavailableError({
            reason: support.reason || "no sandbox backend exists for this platform",
          })
        if (process.platform === "win32" && current.network === "deny")
          // Verified against ProcessContainer on Windows 11 (SDK 1.1.0): the request is accepted but direct
          // egress is not blocked, so a network-deny policy cannot be honored. Fail closed rather than run a
          // command with network access the user denied.
          return yield* new UnavailableError({
            reason: 'the sandbox backend on Windows cannot enforce network denial yet; set sandbox.network to "allow" to run sandboxed with filesystem containment only',
          })
        return yield* Effect.tryPromise(() =>
          mxc.run(request(current, { ...input, workspace: location.directory, tmpRoots })),
        ).pipe(
          Effect.map((result) => ({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
          })),
          Effect.mapError(
            (error) =>
              new UnavailableError({
                reason: `the sandbox backend failed to run the command: ${String(error.cause ?? error)}`,
              }),
          ),
        )
      })
      return Service.of({ policy, execute })
    }),
  )

export const node = makeLocationNode({
  service: Service,
  layer: layer(),
  deps: [Config.node, Location.node],
})
