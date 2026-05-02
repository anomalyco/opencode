import type { Argv } from "yargs"
import { Effect, Schema } from "effect"
import { AppRuntime, type AppServices } from "@/effect/app-runtime"
import { InstanceStore } from "@/project/instance-store"
import { cmd } from "./cmd/cmd"
import { UI } from "./ui"

/**
 * User-visible command failure. Use `fail("...")` from a handler to surface a
 * non-zero exit with a printed message. Anything else escapes as a defect and
 * the runtime prints the cause.
 */
export class CliError extends Schema.TaggedErrorClass<CliError>()("CliError", {
  message: Schema.String,
  exitCode: Schema.optional(Schema.Number),
}) {}

export const fail = (message: string, exitCode = 1) => Effect.fail(new CliError({ message, exitCode }))

/**
 * Effect-native CLI command builder. Wraps yargs `cmd()` with:
 * - `InstanceStore.provide` so `InstanceRef` is available inside the handler
 * - `AppRuntime.runPromise` so any AppServices can be yielded directly
 * - `CliError` interception so domain failures translate to a clean exit
 *
 * The handler is typically an `Effect.fn("Cli.<name>")(function*(args){...})` value,
 * which gives each CLI run a named tracing span automatically. Eventually `cmd()` can
 * swap to effect/cli's `Command.make(...)` without touching the handler bodies.
 */
export const effectCmd = <Args, A>(opts: {
  command: string | readonly string[]
  describe: string | false
  builder?: (yargs: Argv) => Argv<Args>
  /** Defaults to process.cwd(). Override for commands that take a directory positional. */
  directory?: (args: Args) => string
  handler: (args: Args) => Effect.Effect<A, CliError, AppServices | InstanceStore.Service>
}) =>
  cmd<unknown, Args>({
    command: opts.command,
    describe: opts.describe,
    builder: opts.builder as never,
    async handler(args) {
      const directory = opts.directory?.(args as Args) ?? process.cwd()
      const program = InstanceStore.Service.use((s) => s.provide({ directory }, opts.handler(args as Args))).pipe(
        Effect.catchTag("CliError", (e) =>
          Effect.sync(() => {
            UI.error(e.message)
            process.exit(e.exitCode ?? 1)
          }),
        ),
      )
      await AppRuntime.runPromise(program)
    },
  })
