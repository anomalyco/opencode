import { cancel, isCancel, log, outro } from "@clack/prompts"
import { Effect } from "effect"
import { EOL } from "node:os"

export class CancelledError extends Error {
  constructor() {
    super("Cancelled")
  }
}

export function prompt<A>(run: () => Promise<A | symbol>) {
  return Effect.tryPromise({
    try: async () => {
      const value = await run()
      if (isCancel(value)) throw new CancelledError()
      return value as A
    },
    catch: (cause) => cause,
  })
}

export function interactive(message: string) {
  if (process.stdin.isTTY && process.stdout.isTTY) return Effect.void
  return Effect.fail(new Error(message))
}

export const openUrl = Effect.fn("cli.prompt.open-url")(function* (url: string) {
  const { default: open } = yield* Effect.promise(() => import("open"))
  yield* Effect.promise(() => open(url)).pipe(Effect.ignore)
})

export function handlePromptErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catchIf(
      (error) => error instanceof CancelledError,
      () =>
        Effect.sync(() => {
          cancel("Cancelled")
          process.exitCode = 130
        }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        log.error(message(error))
        outro("Failed")
        process.exitCode = 1
      }),
    ),
  )
}

export function handleCommandErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(message(error) + EOL)
        process.exitCode = 1
      }),
    ),
  )
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}
