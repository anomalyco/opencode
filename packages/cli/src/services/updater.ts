import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppProcess } from "@opencode-ai/core/process"
import {
  InstallationChannel,
  InstallationLocal,
  InstallationVersion,
} from "@opencode-ai/core/installation/version"
import { Context, Duration, Effect, FileSystem, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import semver from "semver"

declare const OPENCODE_CLI_NAME: string | undefined

export type Policy = boolean | "notify"
export type Action = "none" | "upgrade"
type Method = "npm" | "pnpm" | "bun" | "yarn"

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

export function action(current: string, latest: string, policy: Policy): Action {
  if (policy === false) return "none"
  if (!semver.valid(current) || !semver.valid(latest) || semver.eq(latest, current)) return "none"
  // Major upgrades are never installed automatically.
  if (semver.major(latest) !== semver.major(current)) return "none"
  return "upgrade"
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const appProcess = yield* AppProcess.Service
    const channel = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")

    const readPolicy = Effect.fnUntraced(function* () {
      const values = yield* Effect.forEach(["config.json", "opencode.json", "opencode.jsonc"], (name) =>
        fs
          .readFileString(path.join(global.config, name))
          .pipe(Effect.map(decodePolicy), Effect.catch(() => Effect.succeed(undefined))),
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
          Effect.catch(() => Effect.succeed({ code: 1, stdout: "", stderr: "" })),
        )
    })

    const method = Effect.fnUntraced(function* () {
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
          fetch(
            `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(InstallationChannel)}`,
            { headers: { "User-Agent": `opencode/${InstallationVersion}` }, signal: AbortSignal.timeout(10_000) },
          ),
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
      const commands: Record<Method, string[]> = {
        npm: ["npm", "install", "--global", target],
        pnpm: ["pnpm", "install", "--global", target],
        bun: ["bun", "install", "--global", target],
        yarn: ["yarn", "global", "add", target],
      }
      const result = yield* run(commands[method], "5 minutes")
      if (result.code === 0) return
      return yield* Effect.fail(new Error(result.stderr.trim() || `Failed to update with ${method}`))
    })

    const check = Effect.fn("cli.updater.check")(function* () {
      if (InstallationLocal || Flag.OPENCODE_DISABLE_AUTOUPDATE)
        return yield* Effect.logInfo("update check skipped", {
          reason: InstallationLocal ? "local-install" : "disabled",
          version: InstallationVersion,
          channel: InstallationChannel,
        })
      const policy = yield* readPolicy()
      if (policy === false) return yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })

      return yield* Effect.gen(function* () {
        const version = yield* latest()
        yield* Effect.logInfo("update check", {
          current: InstallationVersion,
          latest: version,
        })
        const next = action(InstallationVersion, version, policy)
        if (next === "none") return yield* Effect.logInfo("update check done", { action: "up-to-date" })
        const detected = yield* method()
        if (!detected) return yield* Effect.logWarning("automatic update skipped: installation method not found")
        yield* upgrade(detected, version)
        yield* Effect.logInfo("updated OpenCode", { from: InstallationVersion, to: version, method: detected })
      })
    }, Effect.catchCause((cause) => Effect.logWarning("automatic update failed", { cause })))

    return Service.of({ check })
  }),
)

export * as Updater from "./updater"
