import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createAltHold } from "./alt-hold"

describe("createAltHold", () => {
  test("is active only while Alt is held and resets on blur", () => {
    let active = () => false
    let presses = 0
    const dispose = createRoot((dispose) => {
      active = createAltHold(true, () => presses++)
      return dispose
    })

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", repeat: true }))
    expect(active()).toBe(true)
    expect(presses).toBe(1)

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }))
    expect(active()).toBe(false)

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }))
    window.dispatchEvent(new Event("blur"))
    expect(active()).toBe(false)
    expect(presses).toBe(2)
    dispose()
  })

  test("does nothing outside Desktop", () => {
    let presses = 0
    const active = createRoot((dispose) => {
      const value = createAltHold(false, () => presses++)
      dispose()
      return value
    })

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }))
    expect(active()).toBe(false)
    expect(presses).toBe(0)
  })
})
