import { describe, expect, test } from "bun:test"
import { createStashArm } from "../../src/prompt/stash-arm"

describe("stash arm", () => {
  test("requires the same gesture twice and clears after confirmation", () => {
    let current: "esc" | "left" | null = null
    const arm = createStashArm({
      current: () => current,
      set: (value) => (current = value),
    })

    expect(arm.press("esc")).toBe(false)
    expect(arm.current()).toBe("esc")
    expect(arm.press("esc")).toBe(true)
    expect(arm.current()).toBeNull()
    arm.dispose()
  })

  test("switching gestures starts a fresh confirmation window", () => {
    let current: "esc" | "left" | null = null
    const arm = createStashArm({
      current: () => current,
      set: (value) => (current = value),
    })

    expect(arm.press("esc")).toBe(false)
    expect(arm.press("left")).toBe(false)
    expect(arm.current()).toBe("left")
    arm.dispose()
  })

  test("an expired timer cannot clear a newer arm", () => {
    let current: "esc" | "left" | null = null
    const timers: { callback(): void; canceled: boolean }[] = []
    const arm = createStashArm({
      current: () => current,
      set: (value) => (current = value),
      schedule: (callback) => {
        const timer = { callback, canceled: false }
        timers.push(timer)
        return () => (timer.canceled = true)
      },
    })

    expect(arm.press("esc")).toBe(false)
    arm.clear()
    expect(arm.press("esc")).toBe(false)
    expect(timers[0]?.canceled).toBe(true)

    timers[0]?.callback()
    expect(arm.current()).toBe("esc")

    timers[1]?.callback()
    expect(arm.current()).toBeNull()
    arm.dispose()
  })
})
