import { cancel, isCancel, log, outro } from "@clack/prompts"
import { Effect } from "effect"
import { errorMessage } from "../util/error"

const cancelled = Symbol("cancelled")

export function prompt<A>(run: () => Promise<A | symbol>) {
  return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.flatMap((value) => (isCancel(value) ? Effect.fail(cancelled) : Effect.succeed(value))),
  )
}

export function requireInteractive(message: string) {
  if (process.stdin.isTTY && process.stdout.isTTY) return Effect.void
  return Effect.fail(new Error(message))
}

export const openUrl = Effect.fn("cli.prompt.open-url")(function* (url: string) {
  const browser = yield* Effect.promise(() => import("@opencode/util/open"))
  yield* Effect.promise(() => browser.openUrl(url)).pipe(Effect.ignore)
})

export function handlePromptErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(
    Effect.onInterrupt(() => Effect.sync(() => cancel("Cancelled"))),
    Effect.catchIf(
      (error) => error === cancelled,
      () =>
        Effect.sync(() => {
          cancel("Cancelled")
          process.exitCode = 130
        }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        log.error(errorMessage(error))
        outro("Failed")
        process.exitCode = 1
      }),
    ),
  )
}
