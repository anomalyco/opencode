import { describe, expect, test } from "bun:test"
import { PROJECT_ICON_STYLES } from "./procedural"

describe("procedural project icon styles", () => {
  test.each(PROJECT_ICON_STYLES.map((style) => [style.id, style] as const))(
    "%s resolves the same finite params from the same key",
    (id, style) => {
      const icon = style.generate("harbor-api")

      expect(style.generate("harbor-api")).toEqual(icon)
      expect(style.generate("basalt")).not.toEqual(icon)
      expect(icon.style).toBe(id)
      expect(Object.values(icon.params).every(Number.isFinite)).toBe(true)
    },
  )
})
