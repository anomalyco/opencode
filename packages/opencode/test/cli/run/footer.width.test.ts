import { describe, expect, test } from "bun:test"
import { footerWidthPolicy } from "@/cli/cmd/run/footer.width"

describe("run footer width", () => {
  test("preserves shared dialog and statusline breakpoints", () => {
    const narrow = footerWidthPolicy(79)
    expect(narrow.dialog.narrow).toBe(true)
    expect(narrow.statusline.showActivityMeta).toBe(false)
    expect(narrow.statusline.showCommandHint).toBe(true)
    expect(narrow.statusline.showContextHints).toBe(false)
    expect(narrow.statusline.contextHintLimit).toBe(0)
    expect(narrow.statusline.showModel).toBe(false)

    const command = footerWidthPolicy(65)
    expect(command.statusline.showCommandHint).toBe(false)

    const commandHint = footerWidthPolicy(66)
    expect(commandHint.statusline.showCommandHint).toBe(true)

    const compact = footerWidthPolicy(80)
    expect(compact.dialog.narrow).toBe(false)
    expect(compact.statusline.showActivityMeta).toBe(true)
    expect(compact.statusline.showContextHints).toBe(true)
    expect(compact.statusline.contextHintLimit).toBe(1)
    expect(compact.statusline.showModel).toBe(false)

    const model = footerWidthPolicy(120)
    expect(model.statusline.contextHintLimit).toBe(2)
    expect(model.statusline.showModel).toBe(true)

    const spacious = footerWidthPolicy(150)
    expect(spacious.statusline.contextHintLimit).toBeUndefined()
    expect(spacious.statusline.showModel).toBe(true)
  })
})
