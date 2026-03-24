import { describe, expect, test } from "bun:test"
import { parseTheme } from "../../../src/cli/cmd/tui/context/theme-parse"

describe("theme parser", () => {
  test("accepts schema-compliant theme files", () => {
    expect(
      parseTheme({
        theme: {
          primary: "#0A84FF",
          secondary: "#BF5AF2",
          accent: "#409CFF",
          text: "#F5F5F7",
          textMuted: "#98989E",
          background: "none",
        },
      }),
    ).toBeDefined()
  })

  test("ignores legacy flat theme files", () => {
    expect(
      parseTheme({
        accent: "#409CFF",
        background: "none",
        border: "#3D3D41",
        diff_added: "#30D158",
        diff_modified: "#0A84FF",
        diff_removed: "#FF453A",
        foreground: "#F5F5F7",
        muted: "#98989E",
        name: "liquid-glass",
        primary: "#0A84FF",
        secondary: "#BF5AF2",
        success: "#30D158",
        warning: "#FFD60A",
      }),
    ).toBeUndefined()
  })

  test("ignores wrapped theme files missing required colors", () => {
    expect(
      parseTheme({
        theme: {
          primary: "#0A84FF",
          secondary: "#BF5AF2",
        },
      }),
    ).toBeUndefined()
  })
})
