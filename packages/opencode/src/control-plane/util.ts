import { GlobalBus, type GlobalEvent } from "@/bus/global"

export function waitEvent(input: { timeout: number; signal?: AbortSignal; fn: (event: GlobalEvent) => boolean }) {
  if (input.signal?.aborted) return Promise.reject(input.signal.reason ?? new Error("Request aborted"))

  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(input.signal?.reason ?? new Error("Request aborted"))
    }

    const handler = (event: GlobalEvent) => {
      try {
        if (!input.fn(event)) return
        cleanup()
        resolve()
      } catch (error) {
        cleanup()
        reject(error)
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      GlobalBus.off("event", handler)
      input.signal?.removeEventListener("abort", abort)
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for global event"))
    }, input.timeout)

    GlobalBus.on("event", handler)
    input.signal?.addEventListener("abort", abort, { once: true })
  })
}
