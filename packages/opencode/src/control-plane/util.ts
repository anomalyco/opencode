import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Effect } from "effect"

export function waitEvent(input: { timeout: number; signal?: AbortSignal; fn: (event: GlobalEvent) => boolean }) {
  if (input.signal?.aborted) return Effect.fail(input.signal.reason ?? new Error("Request aborted"))

  return Effect.callback<void, unknown>((resume) => {
    const abort = () => {
      cleanup()
      resume(Effect.fail(input.signal?.reason ?? new Error("Request aborted")))
    }

    const handler = (event: GlobalEvent) => {
      try {
        if (!input.fn(event)) return
        cleanup()
        resume(Effect.void)
      } catch (error) {
        cleanup()
        resume(Effect.fail(error))
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      GlobalBus.off("event", handler)
      input.signal?.removeEventListener("abort", abort)
    }

    const timeout = setTimeout(() => {
      cleanup()
      resume(Effect.fail(new Error("Timed out waiting for global event")))
    }, input.timeout)

    GlobalBus.on("event", handler)
    input.signal?.addEventListener("abort", abort, { once: true })
    return Effect.sync(cleanup)
  })
}
