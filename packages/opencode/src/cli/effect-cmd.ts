import type { Argv } from "yargs"
import { Effect, Schema } from "effect"
import { AppRuntime, type AppServices } from "@/effect/app-runtime"
import { InstanceStore } from "@/project/instance-store"
import { cmd } from "./cmd/cmd"

/**
 * User-visible command failure. Throw via `fail("...")` from an effectCmd handler
 * to surface a printed message + non-zero exit. Recognised by the global error
 * formatter in `src/cli/error.ts` (FormatError), so the existing top-level
 * catch + cleanup in `src/index.ts` runs normally.
 */
export class CliError extends Schema.TaggedErrorClass<CliError>()("CliError", {
  message: Schema.String,
  exitCode: Schema.optional(Schema.Number),
}) {}

export const fail = (message: string, exitCode = 1) => Effect.fail(new CliError({ message, exitCode }))

/**
 * Effect-native CLI command builder. Wraps yargs `cmd()` so the handler body is
 * an `Effect` with `InstanceRef` provided and any `AppServices` yieldable.
 *
 * Errors propagate to the existing top-level handler in `src/index.ts`; use
 * `fail("...")` for user-visible domain failures (clean exit, formatted message).
 *
 * Handlers are typically `Effect.fn("Cli.<name>")(function*(args) { ... })`,
 * which adds a named tracing span per CLI invocation. Once all commands use
 * `effectCmd`, swapping the underlying `cmd()` factory for effect/cli's
 * `Command.make(...)` won't touch any handler bodies.
 */
export const effectCmd = <Args, A>(opts: {
  command: string | readonly string[]
  describe: string | false
  builder?: (yargs: Argv) => Argv<Args>
  /** Defaults to process.cwd(). Override for commands that take a directory positional. */
  directory?: (args: Args) => string
  handler: (args: Args) => Effect.Effect<A, CliError, AppServices | InstanceStore.Service>
}) =>
  cmd<{}, Args>({
    command: opts.command,
    describe: opts.describe,
    builder: opts.builder as never,
    async handler(rawArgs) {
      // yargs typing wraps Args in ArgumentsCamelCase<WithDoubleDash<...>>; cast at the boundary.
      const args = rawArgs as unknown as Args
      const directory = opts.directory?.(args) ?? process.cwd()
      await AppRuntime.runPromise(
        InstanceStore.Service.use((s) => s.provide({ directory }, opts.handler(args))),
      )
    },
  })
