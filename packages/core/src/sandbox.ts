export * as Sandbox from "./sandbox.js"

import fs from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import { Location } from "./location.js"
import { ShellSelect } from "./shell/select.js"
import { SandboxPolicy } from "./sandbox/policy.js"

export const Options = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  fullDiskRead: Schema.optional(Schema.Boolean),
  allowGitWrites: Schema.optional(Schema.Boolean),
  readableRoots: Schema.optional(Schema.Array(Schema.String)),
  writableRoots: Schema.optional(Schema.Array(Schema.String)),
})
export type Options = typeof Options.Type

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Sandbox.UnavailableError", {
  message: Schema.String,
}) {}

export class Settings extends Context.Service<Settings, Options & { readonly databasePath?: string }>()(
  "@opencode/Sandbox/Settings",
) {}

export const settingsConfigured = (input: Options = {}, databasePath?: string) =>
  makeGlobalNode({
    service: Settings,
    layer: Layer.effect(
      Settings,
      Effect.gen(function* () {
        if (!input.enabled) return Settings.of(input)
        if (process.platform !== "darwin")
          return yield* Effect.die(new UnavailableError({ message: "The shell sandbox requires a local macOS host." }))
        const global = yield* Global.Service
        const { MacSandbox } = yield* Effect.promise(() => import("./sandbox/macos.js"))
        const options = yield* Effect.tryPromise({
          try: async () => ({
            ...input,
            readableRoots: await MacSandbox.roots(input.readableRoots ?? []),
            writableRoots: await MacSandbox.roots(input.writableRoots ?? []),
            databasePath:
              databasePath && databasePath !== ":memory:" ? path.resolve(global.data, databasePath) : undefined,
          }),
          catch: (cause) => new UnavailableError({ message: `Invalid sandbox roots: ${cause}` }),
        }).pipe(Effect.orDie)
        const subprocess = yield* AppProcess.Service
        yield* Effect.scoped(
          Effect.gen(function* () {
            const scratch = yield* Effect.acquireRelease(
              Effect.tryPromise(() => fs.mkdtemp(path.join(global.tmp, "sandbox-check-"))),
              (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
            )
            const directory = path.join(scratch, "workspace")
            yield* Effect.tryPromise(() => fs.mkdir(directory))
            const policy = yield* Effect.tryPromise(() =>
              MacSandbox.policy({ ...global, directory, scratch }, options, options.databasePath),
            )
            const launch = MacSandbox.launch(policy, "/bin/sh", ["-c", "exit 0"], {
              PATH: "/usr/bin:/bin",
              HOME: scratch,
              TMPDIR: scratch,
            })
            yield* subprocess
              .run(
                ChildProcess.make(launch.command, launch.args, { cwd: directory, env: launch.env, extendEnv: false }),
                { timeout: "5 seconds", maxOutputBytes: 4096, maxErrorBytes: 4096 },
              )
              .pipe(Effect.flatMap(AppProcess.requireSuccess))
          }),
        ).pipe(
          Effect.mapError((cause) => new UnavailableError({ message: `Sandbox startup check failed: ${cause}` })),
          Effect.orDie,
        )
        return Settings.of(options)
      }),
    ),
    deps: [Global.node, AppProcess.node],
  })

export const settingsNode = settingsConfigured()

export class Service extends Context.Service<
  Service,
  {
    readonly enabled: boolean
    readonly fullDiskRead: boolean
    readonly unavailable?: UnavailableError
    readonly prepare: (invocation: ShellCreateBefore) => Effect.Effect<SandboxPolicy.Launch, UnavailableError>
  }
>()("@opencode/Sandbox") {}

export const configured = (input?: Options) =>
  makeLocationNode({
    service: Service,
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        const location = yield* Location.Service
        const global = yield* Global.Service
        const options = yield* Settings
        if (!options.enabled)
          return Service.of({
            enabled: false,
            fullDiskRead: false,
            prepare: () => Effect.fail(new UnavailableError({ message: "Shell sandboxing is disabled." })),
          })
        if (location.workspaceID !== undefined) {
          const unavailable = new UnavailableError({
            message: "Shell commands are unavailable in remote workspaces while shell sandboxing is enabled.",
          })
          return Service.of({
            enabled: true,
            fullDiskRead: options.fullDiskRead ?? false,
            unavailable,
            prepare: () => Effect.fail(unavailable),
          })
        }
        const { MacSandbox } = yield* Effect.promise(() => import("./sandbox/macos.js"))
        const scratch = yield* Effect.acquireRelease(
          Effect.tryPromise(() => fs.mkdtemp(path.join(global.tmp, "sandbox-"))).pipe(Effect.orDie),
          (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
        )
        const policy = yield* Effect.tryPromise(() =>
          MacSandbox.policy({ ...global, directory: location.directory, scratch }, options, options.databasePath),
        ).pipe(Effect.orDie)
        return Service.of({
          enabled: true,
          fullDiskRead: options.fullDiskRead ?? false,
          prepare: (invocation) =>
            Effect.tryPromise({
              try: async () => {
                await fs.access(MacSandbox.executable, fs.constants.X_OK)
                return MacSandbox.launch(
                  policy,
                  invocation.shell,
                  ShellSelect.args(invocation.shell, invocation.command),
                  SandboxPolicy.environment(invocation.env, scratch),
                )
              },
              catch: (cause) => new UnavailableError({ message: `Unable to prepare shell sandbox: ${cause}` }),
            }),
        })
      }),
    ),
    deps: [input === undefined ? settingsNode : settingsConfigured(input), Location.node, Global.node, AppProcess.node],
  })

export const node = configured()
