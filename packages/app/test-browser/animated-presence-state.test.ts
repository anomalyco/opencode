import { expect, test } from "bun:test"
import { createAnimatedPresenceState } from "@opencode-ai/ui/hooks"
import { createRoot, createSignal } from "solid-js"

test("animates visibility changes without animating initial presence", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>("steer")
    const state = createAnimatedPresenceState(value)

    expect(state()).toEqual({ show: true, animate: false, value: "steer" })

    setValue("queue")
    expect(state()).toEqual({ show: true, animate: false, value: "queue" })

    setValue(undefined)
    expect(state()).toEqual({ show: false, animate: true, value: "queue" })

    setValue("steer")
    expect(state()).toEqual({ show: true, animate: true, value: "steer" })

    dispose()
  })
})

test("animates the first appearance when initially hidden", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal<string | undefined>()
    const state = createAnimatedPresenceState(value)

    expect(state()).toEqual({ show: false, animate: false, value: undefined })

    setValue("steer")
    expect(state()).toEqual({ show: true, animate: true, value: "steer" })

    dispose()
  })
})
