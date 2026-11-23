import { spyOn } from "bun:test"
import { CliRenderer } from "@opentui/core"

/** Counts the open animation-clock subscriptions of every renderer, from now until disposed. */
export function countTickers() {
  const subscribe = CliRenderer.prototype.onAnimationTick
  let open = 0
  const spy = spyOn(CliRenderer.prototype, "onAnimationTick").mockImplementation(function (this: CliRenderer, ...args) {
    const stop = subscribe.apply(this, args)
    let closed = false
    open++
    return () => {
      if (!closed) open--
      closed = true
      stop()
    }
  })
  return Object.assign(() => open, { [Symbol.dispose]: () => spy.mockRestore() })
}
