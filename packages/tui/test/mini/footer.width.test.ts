import { describe, expect, test } from "bun:test"
import { footerWidthPolicy } from "../../src/mini/footer.width"

describe("run footer width", () => {
  test("preserves shared dialog and statusline breakpoints", () => {
    expect([23, 24].map((width) => footerWidthPolicy(width).statusline.showCommandHint)).toEqual([false, true])
    expect([31, 32].map((width) => footerWidthPolicy(width).statusline.showModel)).toEqual([false, true])
    expect([39, 40].map((width) => footerWidthPolicy(width).statusline.showModelVariant)).toEqual([false, true])

    const narrow = footerWidthPolicy(79)
    expect(narrow.dialog.narrow).toBe(true)
    expect(narrow.statusline.showActivityMeta).toBe(false)
    expect(narrow.statusline.showContextHints).toBe(false)
    expect(narrow.statusline.contextHintLimit).toBe(0)

    const compact = footerWidthPolicy(80)
    expect(compact.dialog.narrow).toBe(false)
    expect(compact.statusline.showActivityMeta).toBe(true)
    expect(compact.statusline.showContextHints).toBe(true)
    expect(compact.statusline.contextHintLimit).toBe(1)

    const context = footerWidthPolicy(120)
    expect(context.statusline.contextHintLimit).toBe(2)

    const spacious = footerWidthPolicy(150)
    expect(spacious.statusline.contextHintLimit).toBeUndefined()
  })
})
