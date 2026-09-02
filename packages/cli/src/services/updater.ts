import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { OpenCode } from "@opencode-ai/client"
import { PersistentPty } from "@opencode-ai/schema/persistent-pty"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Ref, Schedule, Semaphore, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { action, parseReleaseVersion, type Action, type Policy } from "./updater-action"

declare const OPENCODE_CLI_NAME: string | undefined

export const methods = ["curl", "npm", "pnpm", "bun", "yarn"] as const
export type Method = (typeof methods)[number]

const binaryName =
  typeof OPENCODE_CLI_NAME === "string" && OPENCODE_CLI_NAME === "opencode2-node" ? "opencode2-node" : "opencode2"

export type Target = { readonly package: string; readonly version: string }

export interface Interface {
  readonly package: string | undefined
  readonly check: () => Effect.Effect<void>
  readonly monitor: (input: {
    readonly url: string
    readonly password: string
    readonly managed: boolean
    readonly notify: (version: string) => Effect.Effect<void>
    readonly restart: (handoff: PersistentPty.Handoff | null) => Effect.Effect<void>
  }) => Effect.Effect<void>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  readonly latest: () => Effect.Effect<Target, Error>
  readonly upgrade: (method: Method, target: Target) => Effect.Effect<void, Error>
}

export type Inspection =
  | { readonly action: "none" }
  | { readonly action: Exclude<Action, "none">; readonly target: Target }

type State =
  | { readonly type: "current" }
  | { readonly type: "available"; readonly target: Target; readonly availableSince: number }
  | { readonly type: "ready-to-restart"; readonly target: Target }

export interface MonitorInput {
  readonly url: string
  readonly password: string
  readonly managed: boolean
  readonly inspect: () => Effect.Effect<Inspection, Error>
  readonly install: (target: Target) => Effect.Effect<boolean, Error>
  readonly restart: (handoff: PersistentPty.Handoff | null) => Effect.Effect<void>
  readonly interval?: Duration.Input
  readonly notificationThreshold?: Duration.Input
  readonly notify: (version: string) => Effect.Effect<void>
}

export const monitorServer = Effect.fnUntraced(function* (input: MonitorInput) {
  const state = yield* Ref.make<State>({ type: "current" })
  const applyLock = yield* Semaphore.make(1)
  const client = OpenCode.make({
    baseUrl: input.url,
    headers: { authorization: `Basic ${btoa(`opencode:${input.password}`)}` },
  })

  const applyIfIdle = () =>
    applyLock.withPermit(
      Effect.gen(function* () {
        const pending = yield* Ref.get(state)
        if (pending.type !== "available") return
        const active = yield* Effect.tryPromise({
          try: () => client.session.active(),
          catch: (cause) => new Error("Failed to read active sessions", { cause }),
        })
        if (Object.keys(active).length > 0) return
        const latest = yield* input.inspect()
        if (latest.action !== "upgrade") {
          yield* Ref.set(state, { type: "current" })
          return
        }
        const installed = yield* input
          .install(latest.target)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("automatic update failed", { cause: error }).pipe(Effect.as(false)),
            ),
          )
        if (!installed) return
        const handoff = input.managed
          ? yield* Effect.tryPromise({
              try: () => client.experimental.persistentPty.handoff(),
              catch: (cause) => new Error("Failed to prepare persistent terminals for restart", { cause }),
            })
          : undefined
        yield* Ref.set(state, { type: "ready-to-restart", target: latest.target })
        if (handoff) yield* input.restart(handoff.handoff)
      }),
    )

  const checkServer = Effect.gen(function* () {
    const result = yield* input.inspect()
    if (result.action === "notify") {
      yield* input.notify(result.target.version)
      return
    }
    if (result.action !== "upgrade") {
      yield* Ref.update(
        state,
        (current): State => (current.type === "ready-to-restart" ? current : { type: "current" }),
      )
      return
    }
    yield* Ref.update(state, (current): State => {
      if (
        current.type === "ready-to-restart" &&
        current.target.version === result.target.version &&
        current.target.package === result.target.package
      )
        return current
      return {
        type: "available",
        target: result.target,
        availableSince: current.type === "available" ? current.availableSince : Date.now(),
      }
    })
    yield* applyIfIdle()
    const pending = yield* Ref.get(state)
    if (
      pending.type === "available" &&
      Date.now() - pending.availableSince >= Duration.toMillis(input.notificationThreshold ?? "3 days")
    )
      yield* input.notify(pending.target.version)
  }).pipe(Effect.catch((cause) => Effect.logWarning("automatic update check failed", { cause })))

  const subscribe = Effect.suspend(() =>
    Stream.fromAsyncIterable(
      client.event.subscribe(),
      (cause) => new Error("Update event stream failed", { cause }),
    ).pipe(
      Stream.runForEach((event) => {
        if (event.type === "server.connected") return applyIfIdle()
        if (
          event.type !== "session.execution.succeeded" &&
          event.type !== "session.execution.failed" &&
          event.type !== "session.execution.interrupted"
        )
          return Effect.void
        return Effect.tryPromise({
          try: () => client.session.wait({ sessionID: event.data.sessionID }),
          catch: (cause) => new Error(`Failed to wait for Session ${event.data.sessionID}`, { cause }),
        }).pipe(Effect.andThen(applyIfIdle()))
      }),
      Effect.catch((cause) => Effect.logWarning("update event stream disconnected", { cause })),
    ),
  ).pipe(Effect.repeat(Schedule.spaced("1 second")))

  return yield* Effect.all(
    [checkServer.pipe(Effect.repeat(Schedule.spaced(input.interval ?? "10 minutes"))), subscribe],
    {
      concurrency: "unbounded",
      discard: true,
    },
  )
})

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  // The CLI only projects this host-level preference instead of initializing
  // the location-scoped server configuration graph.
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null) return
  if ("update" in input) {
    const value = input.update
    if (value === "disable" || value === "notify" || value === "auto") return value
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "auto"
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const channel = OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
  // Read the owning wrapper, not a platform package. This keeps detection working
  // after endpoint-directed renames without baking every past name into the CLI.
  const installedPackage = yield* Effect.gen(function* () {
    const executable = yield* fs.realPath(process.execPath)
    const directory = path.dirname(path.dirname(executable))
    const manifest: { name: string; bin?: Record<string, string> } = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
    const bin = manifest.bin?.[binaryName]
    return bin && path.resolve(directory, bin) === executable ? manifest.name : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

  const readPolicy = Effect.fnUntraced(function* () {
    const values = yield* Effect.forEach(["config.json", "opencode.json", "opencode.jsonc"], (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return values.findLast((value) => value !== undefined) ?? "auto"
  })

  const run = Effect.fnUntraced(function* (command: string[], timeout: Duration.Input = "10 seconds") {
    return yield* appProcess
      .run(ChildProcess.make(command[0], command.slice(1)), {
        timeout,
        maxOutputBytes: 100_000,
        maxErrorBytes: 100_000,
      })
      .pipe(
        Effect.map((result) => ({
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        })),
        Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })),
      )
  })

  const method = Effect.fnUntraced(function* () {
    const binary = path.join(
      global.home,
      ".opencode",
      "bin",
      process.platform === "win32" ? "opencode2.exe" : "opencode2",
    )
    if (path.resolve(process.execPath) === path.resolve(binary)) return "curl"
    if (!installedPackage) return

    const checks: ReadonlyArray<{ method: Method; command: string[] }> = [
      { method: "npm", command: ["npm", "list", "-g", "--depth=0", installedPackage] },
      { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", installedPackage] },
      { method: "bun", command: ["bun", "pm", "ls", "-g"] },
      { method: "yarn", command: ["yarn", "global", "list"] },
    ]
    const results = yield* Effect.forEach(
      checks,
      (check) => run(check.command).pipe(Effect.map((result) => ({ check, result }))),
      { concurrency: "unbounded" },
    )
    return results.find((result) => result.result.stdout.includes(installedPackage))?.check.method
  })

  const latest = Effect.fnUntraced(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(
          `https://update.opencode.ai/api/${encodeURIComponent(channel)}/${encodeURIComponent(OPENCODE_ARTIFACT)}/npm`,
          {
            headers: { "User-Agent": `opencode/${OPENCODE_VERSION}` },
            signal: AbortSignal.timeout(10_000),
          },
        ),
      catch: (cause) => new Error("Failed to check for updates", { cause }),
    })
    if (!response.ok) return yield* Effect.fail(new Error(`Update check failed with status ${response.status}`))
    const data: { version: string; metadata?: { package?: string } } = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new Error("Failed to read update information", { cause }),
    })
    if (!data.metadata?.package) return yield* Effect.fail(new Error("Update information did not include a package"))
    return { package: data.metadata.package, version: data.version.trim().replace(/^v/, "") }
  })

  const upgrade = Effect.fnUntraced(function* (method: Method, input: Target) {
    if (!parseReleaseVersion(input.version)) return yield* Effect.fail(new Error(`Invalid version: ${input.version}`))
    const version = input.version.trim().replace(/^v/, "")
    const target = `${input.package}@${version}`
    if (installedPackage && input.package !== installedPackage && (method === "pnpm" || method === "yarn")) {
      return yield* Effect.fail(
        new Error(
          `Package migration with ${method} requires reinstalling ${target} after removing ${installedPackage}.`,
        ),
      )
    }
    const commands: Record<Exclude<Method, "bun" | "curl">, string[]> = {
      // npm refuses to replace a command owned by a different global package.
      // Retain the old package: uninstalling it can also unlink the new command.
      npm: [
        "npm",
        "install",
        "--global",
        ...(installedPackage && input.package !== installedPackage ? ["--force"] : []),
        target,
      ],
      pnpm: ["pnpm", "add", "--global", `--allow-build=${input.package}`, target],
      yarn: ["yarn", "global", "add", target],
    }
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        if (method === "bun") {
          // Bun does not prune old versions from its shared package cache.
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const cache = yield* fs.makeTempDirectoryScoped({ directory: global.cache, prefix: "update-" })
          return yield* run(["bun", "install", "--global", "--trust", "--cache-dir", cache, target], "5 minutes")
        }
        if (method === "curl") {
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const directory = yield* fs.makeTempDirectoryScoped({ directory: global.cache, prefix: "update-" })
          const installer = path.join(directory, "install")
          const download = yield* run(["curl", "-fsSL", "-o", installer, "https://opencode.ai/v2/install"], "5 minutes")
          if (download.code !== 0) return download
          return yield* run(["bash", installer, "--version", version, "--no-modify-path"], "5 minutes")
        }
        return yield* run(commands[method], "5 minutes")
      }),
    ).pipe(Effect.mapError((cause) => new Error(`Failed to update with ${method}`, { cause })))
    if (result.code === 0) return
    return yield* Effect.fail(new Error(result.stderr.trim() || `Failed to update with ${method}`))
  })

  const inspect = Effect.fnUntraced(function* (): Effect.fn.Return<Inspection, Error> {
    if (OPENCODE_LOCAL || ["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")) {
      yield* Effect.logInfo("update check skipped", {
        reason: OPENCODE_LOCAL ? "local-install" : "disabled",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      })
      return { action: "none" }
    }
    const policy = yield* readPolicy()
    if (policy === "disable") {
      yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })
      return { action: "none" }
    }

    const target = yield* latest()
    yield* Effect.logInfo("update check", {
      current: OPENCODE_VERSION,
      latest: target.version,
      package: target.package,
    })
    const next = action(OPENCODE_VERSION, target.version, policy)
    if (next === "none") {
      if (installedPackage && target.package !== installedPackage && (yield* method()) !== "curl") {
        return { action: policy === "notify" ? "notify" : "upgrade", target }
      }
      yield* Effect.logInfo("update check done", { action: "up-to-date" })
      return { action: "none" }
    }
    if (next === "notify") {
      yield* Effect.logInfo("OpenCode update available", { current: OPENCODE_VERSION, latest: target.version })
      return { action: next, target }
    }
    return { action: next, target }
  })

  const install = Effect.fnUntraced(function* (target: Target) {
    const detected = yield* method()
    if (!detected) {
      yield* Effect.logWarning("automatic update skipped: installation method not found")
      return false
    }
    yield* upgrade(detected, target)
    yield* Effect.logInfo("updated OpenCode", {
      from: OPENCODE_VERSION,
      to: target.version,
      package: target.package,
      method: detected,
    })
    return true
  })

  const apply = Effect.fn("cli.updater.apply")(function* (version: string) {
    const target = yield* latest()
    if (target.version !== version)
      return yield* Effect.fail(new Error("Update target changed. Check for updates again."))
    if (!(yield* install(target))) return yield* Effect.fail(new Error("Installation method not found"))
  })

  const check = Effect.fn("cli.updater.check")(
    function* () {
      const result = yield* inspect()
      if (result.action !== "upgrade") return
      yield* install(result.target)
    },
    Effect.catchCause((cause) => Effect.logWarning("automatic update failed", { cause })),
  )

  const monitor = Effect.fn("cli.updater.monitor")(function* (input: {
    readonly url: string
    readonly password: string
    readonly managed: boolean
    readonly notify: (version: string) => Effect.Effect<void>
    readonly restart: (handoff: PersistentPty.Handoff | null) => Effect.Effect<void>
  }) {
    return yield* monitorServer({ ...input, inspect, install })
  })

  return Service.of({ package: installedPackage, check, monitor, apply, method, latest, upgrade })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
