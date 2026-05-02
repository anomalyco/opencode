import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Effect } from "effect"

export function waitGlobalBusEvent(input: {
  timeout?: number
  message?: string
  predicate: (event: GlobalEvent) => boolean
}) {
  return Effect.callback<GlobalEvent, unknown>((resume) => {
    const cleanup = () => {
      clearTimeout(timeout)
      GlobalBus.off("event", handler)
    }

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

    const timeout = setTimeout(() => {
      cleanup()
      resume(Effect.fail(new Error(input.message ?? "timed out waiting for global bus event")))
    }, input.timeout ?? 10_000)

    GlobalBus.on("event", handler)
    return Effect.sync(cleanup)
  })
}

export const waitGlobalBusEventPromise = (input: Parameters<typeof waitGlobalBusEvent>[0]) =>
  Effect.runPromise(waitGlobalBusEvent(input))
