export * as Sandbox from "./sandbox.js"

import fs from "node:fs/promises"
import path from "node:path"
import { Cache, Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import { Location } from "./location.js"
import { Reference } from "./reference.js"
import { SandboxPolicy } from "./sandbox/policy.js"
import { ShellSelect } from "./shell/select.js"
import type { SandboxFiles } from "./sandbox/files.js"

export type Options = SandboxPolicy.Options
export type Launch = SandboxPolicy.Launch

export const Options = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  approval: Schema.optional(Schema.Literals(["on-request", "never"])),
  fullDiskRead: Schema.optional(Schema.Boolean),
  readableRoots: Schema.optional(Schema.Array(Schema.String)),
  writableRoots: Schema.optional(Schema.Array(Schema.String)),
})

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Sandbox.UnavailableError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly enabled: boolean
  readonly scratch?: string
  readonly approval: "on-request" | "never"
  readonly fullDiskRead: boolean
  readonly status: () => Effect.Effect<
    {
      readonly active: boolean
      readonly reads: "unrestricted" | "restricted" | "broad"
      readonly escalation: "on-request" | "never" | "disabled"
      readonly writableRoots: readonly string[]
      readonly readableRoots: readonly string[]
    },
    UnavailableError
  >
  readonly checkLocation: (target: Location.Ref) => Effect.Effect<void, UnavailableError>
  readonly files: Effect.Effect<SandboxFiles.Interface, UnavailableError>
  readonly search: (command: string) => Effect.Effect<Launch, UnavailableError>
  readonly command: (input: Launch) => Effect.Effect<Launch, UnavailableError>
  readonly prepare: (invocation: ShellCreateBefore, escalated: boolean) => Effect.Effect<Launch, UnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Sandbox") {}

export class Settings extends Context.Service<Settings, Options>()("@opencode/Sandbox/Settings") {}

// The server builds this global node before reporting readiness; Location eviction
// must neither re-resolve configured aliases nor repeat the host runtime probe.
export const settingsConfigured = (input: Options = {}) =>
  makeGlobalNode({
    service: Settings,
    layer: Layer.effect(
      Settings,
      Effect.gen(function* () {
        if (input.enabled !== true) return Settings.of({ ...input })
        if (process.platform !== "darwin")
          return yield* Effect.die(
            new UnavailableError({
              message:
                "Sandbox startup failed: only local macOS execution is supported. Disable sandboxing explicitly to run on this host.",
            }),
          )
        const global = yield* Global.Service
        const { MacSandbox } = yield* Effect.promise(() => import("./sandbox/macos.js"))
        const options = yield* Effect.tryPromise({
          try: async () => ({
            ...input,
            readableRoots: await MacSandbox.roots(input.readableRoots ?? []),
            writableRoots: await MacSandbox.roots(input.writableRoots ?? []),
          }),
          catch: (cause) =>
            new UnavailableError({
              message: `Invalid sandbox roots: ${cause}. Configured roots must be existing absolute paths.`,
            }),
        }).pipe(Effect.orDie)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const scratch = yield* Effect.acquireRelease(
              Effect.tryPromise(() => fs.mkdtemp(path.join(global.tmp, "sandbox-check-"))),
              (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
            )
            const directory = path.join(scratch, "workspace")
            yield* Effect.tryPromise(() => fs.mkdir(directory))
            const policy = yield* Effect.tryPromise(() => MacSandbox.policy({ ...global, directory, scratch }, options))
            const { SandboxCheck } = yield* Effect.promise(() => import("./sandbox/check.js"))
            yield* SandboxCheck.run(policy)
          }),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new UnavailableError({
                message: `Sandbox startup check failed: ${cause instanceof Error ? cause.message : cause}. Check /usr/bin/sandbox-exec, runtime access and whether the parent process permits Seatbelt profiles. No unsandboxed fallback was used.`,
              }),
          ),
          Effect.orDie,
        )
        return Settings.of(options)
      }),
    ),
    deps: [Global.node, AppProcess.node],
  })

export const settingsNode = settingsConfigured()

export const configured = (input?: Options) => {
  return makeLocationNode({
    service: Service,
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        const location = yield* Location.Service
        const global = yield* Global.Service
        const subprocess = yield* AppProcess.Service
        const references = yield* Reference.Service
        const options = yield* Settings
        const enabled = options.enabled === true
        const approval = options.approval ?? "on-request"
        // Scratch lives as long as this Location, including its background jobs.
        const scratch =
          enabled && process.platform === "darwin" && location.workspaceID === undefined
            ? yield* Effect.acquireRelease(
                Effect.tryPromise({
                  try: () => fs.mkdtemp(path.join(global.tmp, "sandbox-")),
                  catch: (cause) =>
                    new UnavailableError({ message: `Cannot create sandbox scratch directory: ${cause}` }),
                }).pipe(Effect.orDie),
                (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
              )
            : undefined
        const backend = scratch ? yield* Effect.promise(() => import("./sandbox/macos.js")) : undefined
        // Resolve grants once. Re-resolving a workspace-controlled symlink on every invocation
        // would let a command redirect a configured grant to a different host directory.
        const policy =
          backend && scratch
            ? yield* Effect.tryPromise({
                try: () => backend.MacSandbox.policy({ ...global, directory: location.directory, scratch }, options),
                catch: (cause) => new UnavailableError({ message: `Unable to initialize shell sandbox: ${cause}` }),
              }).pipe(Effect.orDie)
            : undefined

        if (enabled && (!backend || !policy || !scratch))
          return yield* Effect.die(
            new UnavailableError({ message: "Sandboxed Locations require a local macOS execution host." }),
          )
        if (policy) {
          const { SandboxCheck } = yield* Effect.promise(() => import("./sandbox/check.js"))
          yield* SandboxCheck.run(policy, false).pipe(
            Effect.mapError(
              (cause) =>
                new UnavailableError({
                  message: `Sandbox workspace check failed: ${cause instanceof Error ? cause.message : cause}`,
                }),
            ),
            Effect.orDie,
          )
        }

        // Reference registrations can change after Location startup, including asynchronous Git clones.
        // Pin each existing alias for this Location so a workspace symlink cannot redirect its grant.
        const pinnedReferences = new Map<string, string>()
        const effectivePolicy = Effect.fn("Sandbox.effectivePolicy")(function* () {
          if (!policy || !backend) return yield* new UnavailableError({ message: "Sandbox policy is unavailable." })
          const entries = yield* references.list()
          return yield* Effect.tryPromise({
            try: async () => {
              const roots = await Promise.all(
                entries.map(async (entry) => {
                  const resolved = await fs.realpath(entry.path).catch((error: NodeJS.ErrnoException) => {
                    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined
                    throw error
                  })
                  if (!resolved || !(await fs.stat(resolved)).isDirectory()) return undefined
                  const pinned = pinnedReferences.get(entry.path)
                  if (pinned !== undefined && pinned !== resolved)
                    throw new Error(`Reference target changed: ${entry.path}`)
                  pinnedReferences.set(entry.path, resolved)
                  return resolved
                }),
              )
              return backend.MacSandbox.references(
                policy,
                global,
                roots.filter((root): root is string => root !== undefined),
              )
            },
            catch: (cause) => new UnavailableError({ message: `Unable to prepare reference access: ${cause}` }),
          })
        })

        const searches = yield* Cache.make({
          capacity: 1,
          lookup: (command: string) =>
            Effect.tryPromise({
              try: async () => {
                if (!enabled || !backend || !policy || !scratch)
                  throw new Error("Confined search requires a local macOS execution host")
                await fs.access(backend.MacSandbox.executable, fs.constants.X_OK)
                // The managed binary can live under host state, which is intentionally unreadable.
                // Copy this one trusted executable into private scratch; never grant the state directory.
                await fs.mkdir(path.join(scratch, ".runtime"), { recursive: true })
                const directory = await fs.mkdtemp(path.join(scratch, ".runtime", "search-"))
                const binary = path.join(directory, "rg")
                await fs.copyFile(await fs.realpath(command), binary)
                await fs.chmod(binary, 0o500)
                return { binary, directory }
              },
              catch: (cause) => new UnavailableError({ message: `Unable to prepare confined search: ${cause}` }),
            }),
        })

        const command = Effect.fn("Sandbox.command")(function* (input: Launch) {
          if (!enabled || !backend || !policy || !scratch)
            return yield* new UnavailableError({ message: "Command sandboxing requires a local macOS execution host." })
          const current = yield* effectivePolicy()
          return yield* Effect.tryPromise({
            try: async () => {
              await fs.access(backend.MacSandbox.executable, fs.constants.X_OK)
              return backend.MacSandbox.launch(
                current,
                input.command,
                input.args,
                SandboxPolicy.environment(input.env, scratch),
              )
            },
            catch: (cause) => new UnavailableError({ message: `Unable to prepare command sandbox: ${cause}` }),
          })
        })

        return Service.of({
          enabled,
          scratch,
          approval,
          fullDiskRead: options.fullDiskRead ?? false,
          status: Effect.fn("Sandbox.status")(function* () {
            const current = enabled ? yield* effectivePolicy() : undefined
            return {
              active: enabled && current !== undefined,
              reads: enabled ? (options.fullDiskRead ? "broad" : "restricted") : "unrestricted",
              escalation: enabled ? approval : "disabled",
              writableRoots: current?.writableRoots ?? [],
              readableRoots: current && backend ? backend.MacSandbox.readableRoots(current) : [],
            }
          }),
          search: Effect.fn("Sandbox.search")(function* (command) {
            if (!backend || !scratch) return yield* new UnavailableError({ message: "Sandbox search is unavailable." })
            const current = yield* effectivePolicy()
            const { binary, directory } = yield* Cache.get(searches, command)
            return backend.MacSandbox.launch(
              { ...current, protectedPaths: [...current.protectedPaths, directory] },
              binary,
              [],
              { PATH: "/usr/bin:/bin", HOME: scratch, TMPDIR: scratch },
            )
          }),
          command,
          checkLocation: Effect.fn("Sandbox.checkLocation")(function* (target: Location.Ref) {
            if (!enabled) return
            if (!policy || target.workspaceID !== location.workspaceID)
              return yield* new UnavailableError({
                message: "Subagents require the caller's local sandbox execution host.",
              })
            const directory = yield* Effect.tryPromise({
              try: () => fs.realpath(target.directory),
              catch: (cause) => new UnavailableError({ message: `Cannot verify subagent sandbox location: ${cause}` }),
            })
            if (directory !== policy.directory)
              return yield* new UnavailableError({
                message:
                  "Subagents must use the caller's sandbox workspace. Start a new child here, or explicitly move the existing child back before continuing it.",
              })
          }),
          files: Effect.gen(function* () {
            if (!enabled || !backend || !policy || !scratch)
              return yield* new UnavailableError({
                message: "Confined file operations require sandboxing on a local macOS execution host.",
              })
            const { SandboxFiles } = yield* Effect.promise(() => import("./sandbox/files.js"))
            const { SandboxFileWorker } = yield* Effect.promise(() => import("./sandbox/file-worker.js"))
            const current = yield* effectivePolicy()
            const launch = yield* Effect.tryPromise({
              try: async () => {
                await fs.access(backend.MacSandbox.executable, fs.constants.X_OK)
                return backend.MacSandbox.fileLaunch(
                  current,
                  await fs.realpath(process.execPath),
                  SandboxFileWorker.configured(current),
                )
              },
              catch: (cause) =>
                new UnavailableError({ message: `Unable to prepare confined file operations: ${cause}` }),
            })
            return SandboxFiles.make({ process: subprocess, launch, directory: location.directory, cwd: scratch })
          }),
          prepare: Effect.fn("Sandbox.prepare")(function* (invocation: ShellCreateBefore, escalated: boolean) {
            if (!enabled)
              return yield* new UnavailableError({ message: "Shell sandboxing is not enabled on this server." })
            if (!backend || !policy || !scratch)
              return yield* new UnavailableError({ message: "Shell sandboxing requires a local macOS execution host." })
            if (escalated && approval === "never")
              return yield* new UnavailableError({ message: "Sandbox escalation is disabled by the server." })
            const current = escalated ? policy : yield* effectivePolicy()
            return yield* Effect.tryPromise({
              try: async () => {
                const command = invocation.shell
                const args = ShellSelect.args(command, invocation.command)
                const env = SandboxPolicy.environment(invocation.env, scratch)
                if (escalated) return { command, args, env }
                await fs.access(backend.MacSandbox.executable, fs.constants.X_OK)
                return backend.MacSandbox.launch(current, command, args, env)
              },
              catch: (cause) => new UnavailableError({ message: `Unable to prepare shell sandbox: ${cause}` }),
            })
          }),
        })
      }),
    ),
    deps: [
      input === undefined ? settingsNode : settingsConfigured(input),
      Location.node,
      Global.node,
      AppProcess.node,
      Reference.node,
    ],
  })
}

export const node = configured()
