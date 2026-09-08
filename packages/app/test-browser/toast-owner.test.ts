import { beforeEach, describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { showToastV2, toasterV2 } from "@opencode-ai/ui/v2/toast-v2"

describe("showToastV2", () => {
  // The toast registry is module state, so each test starts from an empty stack.
  beforeEach(() => {
    toasterV2.dismiss()
  })

  test("coalesces exact active content", () => {
    const first = showToastV2({ title: "Repeated error", description: "Try again" })
    const second = showToastV2({ title: "Repeated error", description: "Try again" })
    const different = showToastV2({ title: "Repeated error", description: "A different error" })

    expect(second).toBe(first)
    expect(different).not.toBe(first)

    toasterV2.dismiss(first)
    toasterV2.dismiss(different)
  })

  test("allows dismissed content to appear again", () => {
    const first = showToastV2("Dismiss and retry")
    toasterV2.dismiss(first)

    const second = showToastV2("Dismiss and retry")
    expect(second).not.toBe(first)

    toasterV2.dismiss(second)
  })

  test("recreates matching content when it is not the topmost toast", () => {
    const first = showToastV2("First toast")
    const topmost = showToastV2("Topmost toast")
    const repeated = showToastV2("First toast")

    expect(repeated).not.toBe(first)

    toasterV2.dismiss(topmost)
    toasterV2.dismiss(repeated)
  })

  test("creates no reactive computations at call time", () => {
    const [tick, setTick] = createSignal(0)
    let reads = 0
    const icon = (() => {
      reads++
      tick()
      return undefined
    }) as unknown as JSX.Element

    const id = showToastV2({ description: "test", icon })

    // Resolving the icon at call time creates an ownerless computation that is
    // never disposed and tracks its dependencies forever; it must only resolve
    // once the toast component renders.
    expect(reads).toBe(0)
    setTick(1)
    expect(reads).toBe(0)

    toasterV2.dismiss(id)
  })
})
