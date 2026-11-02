import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import type { AppProcess } from "@opencode/util/process"
import type { Sandbox } from "../sandbox.js"

/** Both formatter probes and formatting must cross the same execution boundary. */
export const run = Effect.fn("FormatterProcess.run")(function* (input: {
  readonly processes: AppProcess.Interface
  readonly sandbox: Sandbox.Interface
  readonly directory: string
  readonly command: readonly string[]
  readonly environment?: Record<string, string>
  readonly quiet?: boolean
}) {
  const launch = {
    command: input.command[0],
    args: input.command.slice(1),
    env: { ...process.env, ...input.environment },
  }
  const confined = input.sandbox.enabled ? yield* input.sandbox.command(launch) : undefined
  return yield* input.processes.run(
    ChildProcess.make(confined?.command ?? launch.command, confined?.args ?? launch.args, {
      cwd: input.directory,
      env: confined?.env ?? input.environment,
      extendEnv: !confined,
      stdin: "ignore",
      stdout: input.quiet ? "ignore" : "pipe",
      stderr: input.quiet ? "ignore" : "pipe",
    }),
  )
})

export * as FormatterProcess from "./process.js"
