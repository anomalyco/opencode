import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Schedule } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { action, parseReleaseVersion, type Policy } from "./updater-action"

export const methods = ["curl", "npm", "pnpm", "bun", "yarn"] as const
export type Method = (typeof methods)[number]

export interface Interface {
  readonly monitor: (notify: (version: string) => Effect.Effect<void>) => Effect.Effect<void>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  readonly latest: () => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
}

export const monitorUpdates = Effect.fnUntraced(function* (input: {
  readonly inspect: () => Effect.Effect<string | undefined, Error>
  readonly notify: (version: string) => Effect.Effect<void>
  readonly interval?: Duration.Input
}) {
  const interval = input.interval ?? "10 minutes"
  const check = Effect.gen(function* () {
    const version = yield* input.inspect()
    if (version !== undefined) yield* input.notify(version)
  }).pipe(Effect.catch((error) => Effect.logWarning("update check failed", { error })))
  return yield* check.pipe(Effect.repeat(Schedule.spaced(interval)), Effect.delay(interval))
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
    if (value === "disable" || value === "notify") return value
    if (value === "auto") return "notify"
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "notify"
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const channel = OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
  const installedPackage = yield* Effect.gen(function* () {
    const executable = yield* fs.realPath(process.execPath)
    const directory = path.dirname(path.dirname(executable))
    const manifest: { name: string; bin?: Record<string, string> } = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
    if (Object.values(manifest.bin ?? {}).some((bin) => path.resolve(directory, bin) === executable))
      return manifest.name
  }).pipe(Effect.orElseSucceed(() => undefined))

  const readPolicy = Effect.fnUntraced(function* () {
    const values = yield* Effect.forEach(["config.json", "opencode.json", "opencode.jsonc"], (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return values.findLast((value) => value !== undefined) ?? "notify"
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

  const release = Effect.fnUntraced(function* () {
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
    return { package: data.metadata.package, version: data.version }
  })

  const latest = () => release().pipe(Effect.map((data) => data.version))

  const upgrade = Effect.fnUntraced(function* (method: Method, input: string) {
    if (!parseReleaseVersion(input)) return yield* Effect.fail(new Error(`Invalid version: ${input}`))
    const version = input.trim().replace(/^v/, "")
    const packageName = (yield* release()).package
    const target = `${packageName}@${version}`
    if (installedPackage && packageName !== installedPackage && (method === "pnpm" || method === "yarn")) {
      return yield* Effect.fail(new Error(`Reinstall ${target} with ${method} to migrate from ${installedPackage}.`))
    }
    const commands: Record<Exclude<Method, "bun" | "curl">, string[]> = {
      // Keep the old package: uninstalling it can unlink the replacement command.
      npm: [
        "npm",
        "install",
        "--global",
        ...(installedPackage && packageName !== installedPackage ? ["--force"] : []),
        target,
      ],
      pnpm: ["pnpm", "add", "--global", `--allow-build=${packageName}`, target],
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

  const inspect = Effect.fnUntraced(function* () {
    if (OPENCODE_LOCAL || ["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")) {
      yield* Effect.logInfo("update check skipped", {
        reason: OPENCODE_LOCAL ? "local-install" : "disabled",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      })
      return undefined
    }
    const policy = yield* readPolicy()
    if (policy === "disable") {
      yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })
      return undefined
    }

    const version = yield* latest()
    yield* Effect.logInfo("update check", {
      current: OPENCODE_VERSION,
      latest: version,
    })
    const next = action(OPENCODE_VERSION, version, policy)
    if (next === "none") {
      yield* Effect.logInfo("update check done", { action: "up-to-date" })
      return undefined
    }
    yield* Effect.logInfo("OpenCode update available", { current: OPENCODE_VERSION, latest: version })
    return version
  })

  const install = Effect.fnUntraced(function* (version: string) {
    const detected = yield* method()
    if (!detected) {
      yield* Effect.logWarning("update skipped: installation method not found")
      return false
    }
    yield* upgrade(detected, version)
    yield* Effect.logInfo("updated OpenCode", { from: OPENCODE_VERSION, to: version, method: detected })
    return true
  })

  const apply = Effect.fn("cli.updater.apply")(function* (version: string) {
    if (!(yield* install(version))) return yield* Effect.fail(new Error("Installation method not found"))
  })

  const monitor = (notify: (version: string) => Effect.Effect<void>) => monitorUpdates({ inspect, notify })

  return Service.of({ monitor, apply, method, latest, upgrade })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
