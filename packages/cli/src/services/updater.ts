import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Ref } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { action, type Policy } from "./updater-action"

declare const OPENCODE_CLI_NAME: string | undefined

type Method = "npm" | "pnpm" | "bun" | "yarn" | "curl"

const packageName =
  typeof OPENCODE_CLI_NAME === "string" && OPENCODE_CLI_NAME === "opencode2-node"
    ? OPENCODE_CLI_NAME
    : "@opencode-ai/cli"

export interface Interface {
  readonly check: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  // The CLI only projects this host-level preference instead of initializing
  // the location-scoped server configuration graph.
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null || !("autoupdate" in input)) return
  const value = input.autoupdate
  if (typeof value === "boolean" || value === "notify") return value
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const appProcess = yield* AppProcess.Service
    const installed = yield* Ref.make(OPENCODE_VERSION)
    const channel = OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")

    const readPolicy = Effect.fnUntraced(function* () {
      const values = yield* Effect.forEach(["config.json", "opencode.json", "opencode.jsonc"], (name) =>
        fs.readFileString(path.join(global.config, name)).pipe(
          Effect.map(decodePolicy),
          Effect.orElseSucceed(() => undefined),
        ),
      )
      return values.findLast((value) => value !== undefined) ?? true
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

      const checks: ReadonlyArray<{ method: Method; command: string[] }> = [
        { method: "npm", command: ["npm", "list", "-g", "--depth=0", packageName] },
        { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", packageName] },
        { method: "bun", command: ["bun", "pm", "ls", "-g"] },
        { method: "yarn", command: ["yarn", "global", "list"] },
      ]
      const results = yield* Effect.forEach(
        checks,
        (check) => run(check.command).pipe(Effect.map((result) => ({ check, result }))),
        { concurrency: "unbounded" },
      )
      return results.find((result) => result.result.stdout.includes(packageName))?.check.method
    })

    const latest = Effect.fnUntraced(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`https://update.opencode.ai/api/${encodeURIComponent(channel)}/cli/npm`, {
            headers: { "User-Agent": `opencode/${OPENCODE_VERSION}` },
            signal: AbortSignal.timeout(10_000),
          }),
        catch: (cause) => new Error("Failed to check for updates", { cause }),
      })
      if (!response.ok) return yield* Effect.fail(new Error(`Update check failed with status ${response.status}`))
      const data = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => new Error("Failed to read update information", { cause }),
      })
      if (typeof data !== "object" || data === null || !("version" in data) || typeof data.version !== "string") {
        return yield* Effect.fail(new Error("Update information did not include a version"))
      }
      return data.version
    })

    const upgrade = Effect.fnUntraced(function* (method: Method, version: string) {
      const target = `${packageName}@${version}`
      const commands: Record<Exclude<Method, "bun" | "curl" | "npm">, string[]> = {
        pnpm: ["pnpm", "add", "--global", `--allow-build=${packageName}`, target],
        yarn: ["yarn", "global", "add", target],
      }
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          if (method === "bun" || method === "npm") {
            yield* fs.makeDirectory(global.cache, { recursive: true })
            const cache = yield* fs.makeTempDirectoryScoped({ directory: global.cache, prefix: "update-" })
            const command =
              method === "bun"
                ? ["bun", "install", "--global", "--trust", "--cache-dir", cache, target]
                : ["npm", "install", "--global", "--cache", cache, target]
            return yield* run(command, "5 minutes")
          }
          if (method === "curl") {
            yield* fs.makeDirectory(global.cache, { recursive: true })
            const directory = yield* fs.makeTempDirectoryScoped({ directory: global.cache, prefix: "update-" })
            const installer = path.join(directory, "install")
            const download = yield* run(
              ["curl", "-fsSL", "-o", installer, "https://opencode.ai/v2/install"],
              "5 minutes",
            )
            if (download.code !== 0) return download
            return yield* run(["bash", installer, "--version", version, "--no-modify-path"], "5 minutes")
          }
          return yield* run(commands[method], "5 minutes")
        }),
      )
      if (result.code === 0) return
      return yield* Effect.fail(new Error(result.stderr.trim() || `Failed to update with ${method}`))
    })

    const check = Effect.fn("cli.updater.check")(
      function* () {
        if (OPENCODE_LOCAL || ["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? ""))
          return yield* Effect.logInfo("update check skipped", {
            reason: OPENCODE_LOCAL ? "local-install" : "disabled",
            version: OPENCODE_VERSION,
            channel: OPENCODE_CHANNEL,
          })
        const policy = yield* readPolicy()
        if (policy === false) return yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })

        return yield* Effect.gen(function* () {
          const version = yield* latest()
          const current = yield* Ref.get(installed)
          yield* Effect.logInfo("update check", {
            current,
            latest: version,
          })
          const next = action(OPENCODE_VERSION, version, policy, current)
          if (next === "none") return yield* Effect.logInfo("update check done", { action: "up-to-date" })
          if (next === "notify") return yield* Effect.logInfo("OpenCode update available", { current, latest: version })
          const detected = yield* method()
          if (!detected) return yield* Effect.logWarning("automatic update skipped: installation method not found")
          yield* upgrade(detected, version)
          yield* Ref.set(installed, version)
          yield* Effect.logInfo("updated OpenCode", { from: current, to: version, method: detected })
        })
      },
      Effect.catchCause((cause) => Effect.logWarning("automatic update failed", { cause })),
    )

    return Service.of({ check })
  }),
)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
