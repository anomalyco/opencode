import { expect, test } from "bun:test"
import { DEFAULT_THEMES, resolveTheme } from "../src/theme"
import { isRedColor, toolCodeTheme } from "../src/theme/tool-code"

const slots = [
  "error",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "markdownLink",
  "markdownLinkText",
  "markdownHeading",
  "markdownCode",
  "markdownBlockQuote",
  "markdownEmph",
  "markdownStrong",
  "markdownListItem",
  "markdownListEnumeration",
  "warning",
] as const

test("tool code never draws a token in red or in the error color, in any built-in theme", () => {
  for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
    for (const mode of ["dark", "light"] as const) {
      const theme = resolveTheme(json, mode)
      const tool = toolCodeTheme(theme)
      for (const slot of slots) {
        const color = tool[slot]
        expect({ theme: `${name}/${mode}`, slot, red: isRedColor(color) }).toEqual({
          theme: `${name}/${mode}`,
          slot,
          red: false,
        })
        expect({ theme: `${name}/${mode}`, slot, error: color.equals(theme.error) }).toEqual({
          theme: `${name}/${mode}`,
          slot,
          error: false,
        })
      }
    }
  }
})

test("keeps every slot that is not red", () => {
  const theme = resolveTheme(DEFAULT_THEMES.opencode, "dark")
  const tool = toolCodeTheme(theme)
  expect(isRedColor(theme.syntaxVariable)).toBe(true)
  expect(tool.syntaxVariable).toEqual(theme.syntaxFunction)
  expect(tool.syntaxString).toEqual(theme.syntaxString)
  expect(tool.syntaxKeyword).toEqual(theme.syntaxKeyword)
  expect(tool.text).toEqual(theme.text)
})
