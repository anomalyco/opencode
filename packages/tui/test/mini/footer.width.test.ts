import { describe, expect, test } from "bun:test"
import { footerWidthPolicy } from "../../src/mini/footer.width"

describe("run footer width", () => {
  test("preserves shared dialog and statusline breakpoints", () => {
    const narrow = footerWidthPolicy(79)
    expect(narrow.dialog.narrow).toBe(true)
    expect(narrow.statusline.showActivityMeta).toBe(false)
    expect(narrow.statusline.showCommandHint).toBe(true)
    expect(narrow.statusline.showContextHints).toBe(false)
    expect(narrow.statusline.contextHintLimit).toBe(0)

    const command = footerWidthPolicy(65)
    expect(command.statusline.showCommandHint).toBe(false)

    const commandHint = footerWidthPolicy(66)
    expect(commandHint.statusline.showCommandHint).toBe(true)

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
