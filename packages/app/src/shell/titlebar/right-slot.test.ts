import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createTitlebarRightSlot } from "./right-slot"

describe("titlebar right slot", () => {
  test("selects the latest owner and restores the previous owner after overlap", () => {
    createRoot((dispose) => {
      const slot = createTitlebarRightSlot()
      const committed = slot.createRegistration()
      committed.register()
      expect(committed.active()).toBe(true)

      const shadow = slot.createRegistration()
      shadow.register()
      expect(committed.active()).toBe(false)
      expect(shadow.active()).toBe(true)

      shadow.unregister()
      expect(committed.active()).toBe(true)
      expect(shadow.active()).toBe(false)

      committed.unregister()
      expect(committed.active()).toBe(false)
      dispose()
    })
  })
})
