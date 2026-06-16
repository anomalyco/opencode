import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { shouldUseSessionHeaderV2 } from "./session-header-layout"

describe("shouldUseSessionHeaderV2", () => {
  test("uses the new layout accessor value", () => {
    expect(shouldUseSessionHeaderV2(() => false)).toBe(false)
    expect(shouldUseSessionHeaderV2(() => true)).toBe(true)
  })

  test("reads the accessor value each time settings change", () => {
    createRoot((dispose) => {
      const [newLayoutDesigns, setNewLayoutDesigns] = createSignal(false)

      expect(shouldUseSessionHeaderV2(newLayoutDesigns)).toBe(false)
      setNewLayoutDesigns(true)
      expect(shouldUseSessionHeaderV2(newLayoutDesigns)).toBe(true)

      dispose()
    })
  })
})
