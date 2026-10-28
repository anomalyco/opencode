import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionOwnership } from "./session-ownership"

test("rejects work captured by a previous session", () => {
  createRoot((dispose) => {
    const [key, setKey] = createSignal("session-a")
    const ownership = createSessionOwnership(key)
    const captured = ownership.capture()
    let ran = false

    setKey("session-b")

    expect(captured.current()).toBe(false)
    expect(captured.run(() => (ran = true))).toBeUndefined()
    expect(ran).toBe(false)
    dispose()
  })
})
