export * as SessionVerification from "./verification.js"

import path from "path"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Context, Duration, Effect, Layer, Option } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "../config.js"
import { Shell } from "../shell.js"
import { SessionSchema } from "./schema.js"

const DEFAULT_TIMEOUT = Duration.minutes(2)
const DEFAULT_MAX_ATTEMPTS = 1
const MAX_OUTPUT = 8_000
const SCRIPT_ORDER = ["test", "check", "typecheck", "lint"] as const

export type Result =
  | { readonly status: "passed"; readonly command: string; readonly output: string }
  | { readonly status: "failed"; readonly command: string; readonly output: string; readonly exit: number | undefined }
  | { readonly status: "skipped"; readonly reason: string }

export interface Input {
  readonly sessionID: SessionSchema.ID
  readonly directory: string
  /** How many verification attempts already ran in this turn. */
  readonly attempt: number
}

export interface Interface {
  /** Resolve the configured verification command, or undefined when this workspace has none. */
  readonly command: (directory: string) => Effect.Effect<string | undefined>
  /** Run verification once. Never throws for an ordinary command failure. */
  readonly check: (input: Input) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionVerification") {}

const packageManager = (has: (file: string) => Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    if (yield* has("bun.lock")) return "bun"
    if (yield* has("bun.lockb")) return "bun"
    if (yield* has("pnpm-lock.yaml")) return "pnpm"
    if (yield* has("yarn.lock")) return "yarn"
    if (yield* has("package-lock.json")) return "npm"
    return "bun"
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Prefer the first conventional script the package actually defines. */
export const resolveScript = (value: unknown): string | undefined => {
  if (!isRecord(value) || !isRecord(value.scripts)) return undefined
  const scripts = value.scripts
  return SCRIPT_ORDER.find((name) => typeof scripts[name] === "string")
}

export const formatCommand = (manager: string, script: string) =>
  manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const shell = yield* Shell.Service

    const setting = Effect.fn("SessionVerification.setting")(function* () {
      return Config.latest(yield* config.entries(), "experimental")?.verification
    })

    const command = Effect.fn("SessionVerification.command")(function* (directory: string) {
      const configured = yield* setting()
      if (configured === undefined || configured === false) return undefined
      if (configured !== true) return configured.command
      const packageJson = path.join(directory, "package.json")
      const json = yield* fs.readJson(packageJson).pipe(Effect.option)
      if (Option.isNone(json)) return undefined
      const script = resolveScript(json.value)
      if (script === undefined) return undefined
      const exists = (file: string) => fs.existsSafe(path.join(directory, file))
      return formatCommand(yield* packageManager(exists), script)
    })

    const check = Effect.fn("SessionVerification.check")(function* (input: Input) {
      const configured = yield* setting()
      if (configured === undefined || configured === false) return { status: "skipped", reason: "disabled" } as const
      const maxAttempts = typeof configured === "object" ? (configured.max_attempts ?? DEFAULT_MAX_ATTEMPTS) : 1
      if (input.attempt >= maxAttempts) return { status: "skipped", reason: "attempt budget exhausted" } as const
      const resolved = typeof configured === "object" ? configured.command : yield* command(input.directory)
      if (!resolved) return { status: "skipped", reason: "no verification command" } as const
      const timeout = typeof configured === "object" ? (configured.timeout ?? DEFAULT_TIMEOUT) : DEFAULT_TIMEOUT
      const info = yield* shell
        .create({
          command: resolved,
          cwd: input.directory,
          timeout: Duration.toMillis(timeout),
          metadata: { sessionID: input.sessionID, source: "verification" },
        })
        .pipe(
          Effect.catchTag("AppProcessError", (error) =>
            Effect.logWarning("verification command failed to start", {
              sessionID: input.sessionID,
              command: resolved,
              error,
            }).pipe(Effect.as(undefined)),
          ),
        )
      if (!info) return { status: "skipped", reason: "verification command failed to start" } as const
      const result = yield* shell.result(info)
      const output = result.capture?.output ?? "(no output)"
      const text = output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output
      if (result.info.exit === 0) {
        yield* Effect.logInfo("verification passed", { sessionID: input.sessionID, command: resolved })
        return { status: "passed", command: resolved, output: text } as const
      }
      yield* Effect.logWarning("verification failed", {
        sessionID: input.sessionID,
        command: resolved,
        exit: result.info.exit,
      })
      return {
        status: "failed",
        command: resolved,
        output: text,
        exit: result.info.exit,
      } as const
    })

    return Service.of({ command, check })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Shell.node],
})

// Keep the decoded config shape visible to callers without duplicating the schema.
export type Setting = NonNullable<ConfigExperimental.Info["verification"]>
