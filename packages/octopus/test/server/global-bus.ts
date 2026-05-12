import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Cause, Effect } from "effect"

export function waitGlobalBusEvent(input: {
  timeout?: number
  message?: string
  predicate: (event: GlobalEvent) => boolean
}) {
  return Effect.callback<GlobalEvent, unknown>((resume) => {
    const cleanup = () => GlobalBus.off("event", handler)

    const handler = (event: GlobalEvent) => {
      try {
        if (!input.predicate(event)) return
        cleanup()
        resume(Effect.succeed(event))
      } catch (error) {
        cleanup()
        resume(Effect.fail(error))
      }
    }

    GlobalBus.on("event", handler)
    return Effect.sync(cleanup)
  }).pipe(
    Effect.timeout(input.timeout ?? 10_000),
    Effect.mapError((error) =>
      Cause.isTimeoutError(error) ? new Error(input.message ?? "timed out waiting for global bus event") : error,
    ),
  )
}

export const waitGlobalBusEventPromise = (input: Parameters<typeof waitGlobalBusEvent>[0]) =>
  Effect.runPromise(waitGlobalBusEvent(input))
