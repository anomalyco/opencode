import { expect, test } from "bun:test"
import { batch, createRoot, createSignal } from "solid-js"
import { createPaneMotion } from "@/session/pane-motion"

test("animates pane toggles but not tab switches", () => {
  createRoot((dispose) => {
    const [key, setKey] = createSignal("a")
    const [opened, setOpened] = createSignal(false)
    const motion = createPaneMotion(key, opened)

    expect(motion.animate()).toBe(false)
    setOpened(true)
    expect(motion.animate()).toBe(true)

    batch(() => {
      setKey("b")
      setOpened(false)
    })
    expect(motion.animate()).toBe(false)

    setOpened(true)
    expect(motion.animate()).toBe(true)
    dispose()
  })
})
