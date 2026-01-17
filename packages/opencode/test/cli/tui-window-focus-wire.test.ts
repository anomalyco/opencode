import { describe, expect, test } from "bun:test"
import { EventEmitter } from "events"
import { windowFocus } from "../../src/cli/cmd/tui/util/window-focus"

class Renderer extends EventEmitter {
  override on(event: string, fn: () => void) {
    return super.on(event, fn)
  }
  override off(event: string, fn: () => void) {
    return super.off(event, fn)
  }
}

describe("windowFocus", () => {
  test("publishes focus and blur", async () => {
    const renderer = new Renderer()
    const calls: boolean[] = []
    const cleanup = windowFocus({
      renderer,
      publish(value) {
        calls.push(value)
      },
    })

    renderer.emit("focus")
    renderer.emit("blur")

    expect(calls).toEqual([true, false])

    cleanup()

    renderer.emit("focus")
    expect(calls).toEqual([true, false])
  })
})
