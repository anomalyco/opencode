import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { DEFAULT_THEMES, resolveTheme } from "../../../src/cli/cmd/tui/context/theme-resolver"

test("resolveTheme falls back to legacy XML/HTML syntax colors", () => {
  const theme = {
    ...DEFAULT_THEMES.opencode,
    theme: {
      ...DEFAULT_THEMES.opencode.theme,
    },
  }

  delete theme.theme.syntaxTag
  delete theme.theme.syntaxAttribute
  delete theme.theme.syntaxTagDelimiter

  const resolved = resolveTheme(theme, "dark")

  expect(resolved.syntaxTag).toBe(resolved.error)
  expect(resolved.syntaxAttribute).toBe(resolved.syntaxKeyword)
  expect(resolved.syntaxTagDelimiter).toBe(resolved.syntaxOperator)
})

test("resolveTheme honors explicit XML/HTML syntax tokens", () => {
  const syntaxTag = RGBA.fromInts(10, 20, 30)
  const syntaxAttribute = RGBA.fromInts(40, 50, 60)
  const syntaxTagDelimiter = RGBA.fromInts(70, 80, 90)

  const theme = {
    ...DEFAULT_THEMES.opencode,
    theme: {
      ...DEFAULT_THEMES.opencode.theme,
      syntaxTag,
      syntaxAttribute,
      syntaxTagDelimiter,
    },
  }

  const resolved = resolveTheme(theme, "dark")

  expect(resolved.syntaxTag).toBe(syntaxTag)
  expect(resolved.syntaxAttribute).toBe(syntaxAttribute)
  expect(resolved.syntaxTagDelimiter).toBe(syntaxTagDelimiter)
})
