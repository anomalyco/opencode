import { expect, test } from "bun:test"
import { createAnimatedPresence } from "../src/runtime/animated-presence"
import { createRoot, createSignal } from "solid-js"

test("animates visibility changes without animating initial presence", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>("steer")
    const presence = createAnimatedPresence(value, () => null)

    expect(presence.show()).toBe(true)
    expect(presence.animate()).toBe(false)
    expect(presence.value()).toBe("steer")
    expect(presence.present()).toBe(true)

    setValue("queue")
    expect(presence.animate()).toBe(false)
    expect(presence.value()).toBe("queue")

    setValue(undefined)
    expect(presence.show()).toBe(false)
    expect(presence.animate()).toBe(true)
    expect(presence.value()).toBe("queue")

    setValue("steer")
    expect(presence.show()).toBe(true)
    expect(presence.animate()).toBe(true)
    expect(presence.value()).toBe("steer")

    dispose()
  })
})

test("animates the first appearance when initially hidden", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>()
    const presence = createAnimatedPresence(value, () => null)

    expect(presence.show()).toBe(false)
    expect(presence.animate()).toBe(false)
    expect(presence.present()).toBe(false)

    setValue("steer")
    expect(presence.show()).toBe(true)
    expect(presence.animate()).toBe(true)
    expect(presence.value()).toBe("steer")

    dispose()
  })
})
