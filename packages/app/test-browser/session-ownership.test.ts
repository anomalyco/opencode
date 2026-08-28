import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionOwnership } from "@/pages/session/session-ownership"

describe("createSessionOwnership", () => {
  test("invalidates captured work when its Solid owner is disposed", () => {
    let current = true
    createRoot((dispose) => {
      const owner = createSessionOwnership(() => "A").capture()
      dispose()
      current = owner.current()
    })

    expect(current).toBe(false)
  })

  test("does not run a continuation after navigation", () => {
    createRoot((dispose) => {
      const [session, setSession] = createSignal("A")
      const owner = createSessionOwnership(session).capture()
      let ran = false

      setSession("B")
      owner.run(() => {
        ran = true
      })

      expect(ran).toBe(false)
      dispose()
    })
  })

  test("does not revive a continuation after A to B to A navigation", () => {
    createRoot((dispose) => {
      const [session, setSession] = createSignal("A")
      const owner = createSessionOwnership(session).capture()

      setSession("B")
      setSession("A")

      expect(owner.current()).toBe(false)
      dispose()
    })
  })
})
