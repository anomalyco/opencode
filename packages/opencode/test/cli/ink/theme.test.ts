import { describe, it, expect } from "bun:test"
import { theme, type Theme } from "@/cli/ink/theme"

describe("theme", () => {
  it("exports required color tokens with correct values", () => {
    expect(theme.colors.primary).toBe("cyan")
    expect(theme.colors.success).toBe("green")
    expect(theme.colors.warning).toBe("yellow")
    expect(theme.colors.error).toBe("red")
    expect(theme.colors.muted).toBe("gray")
  })

  it("exports tool status colors with correct values", () => {
    expect(theme.tool.running.icon).toBe("yellow")
    expect(theme.tool.running.text).toBe("gray")
    expect(theme.tool.completed.icon).toBe("green")
    expect(theme.tool.completed.text).toBe("gray")
    expect(theme.tool.error.icon).toBe("red")
    expect(theme.tool.error.text).toBe("gray")
  })

  it("exports task status colors with correct values", () => {
    expect(theme.task.running.icon).toBe("yellow")
    expect(theme.task.running.text).toBe("cyan")
    expect(theme.task.completed.icon).toBe("green")
    expect(theme.task.completed.text).toBe("cyan")
  })

  it("exports prompt tokens with correct values", () => {
    expect(theme.prompt.agent).toBe("cyan")
    expect(theme.prompt.separator).toBe("cyan")
    expect(theme.prompt.symbol).toBe("❯")
  })

  it("exports status configuration", () => {
    expect(theme.status.dimColor).toBe(true)
  })

  it("exports Theme type for type checking", () => {
    const typedTheme: Theme = theme
    expect(typedTheme).toBe(theme)
  })
})
