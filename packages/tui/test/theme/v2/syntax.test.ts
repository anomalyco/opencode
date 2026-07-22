import { expect, test } from "bun:test"
import { DEFAULT_THEME } from "../../../src/theme/v2/defaults"
import { resolveTheme } from "../../../src/theme/v2/resolve"
import { selectTheme } from "../../../src/theme/v2/select"
import { generateSyntax } from "../../../src/theme/v2/syntax"
import type { Mode } from "../../../src/theme/v2"

test.each(["light", "dark"] as const)("generates %s syntax styles from V2 tokens", (mode) => {
  const theme = resolveTheme(selectTheme(DEFAULT_THEME, mode))
  const syntax = generateSyntax(theme, mode)
  const step = mode === "light" ? 800 : 200

  try {
    expect(syntax.getRegisteredNames()).toHaveLength(101)
    expect(syntax.getStyleId("extmark.file")).not.toBeNull()
    expect(syntax.getStyleId("extmark.agent")).not.toBeNull()
    expect(syntax.getStyleId("extmark.paste")).not.toBeNull()
    expect(color(syntax, "default")).toEqual(theme.text.default.toInts())
    expect(color(syntax, "prompt")).toEqual(theme.hue.accent[step].toInts())
    expect(color(syntax, "extmark.file")).toEqual(theme.text.feedback.warning.default.toInts())
    expect(color(syntax, "extmark.agent")).toEqual(theme.categorical[0][step].toInts())
    expect(color(syntax, "extmark.paste")).toEqual(theme.text.action.primary.focused.toInts())
    expect(background(syntax, "extmark.paste")).toEqual(theme.text.feedback.warning.default.toInts())
    expect(color(syntax, "comment")).toEqual(theme.syntax.comment.toInts())
    expect(color(syntax, "keyword")).toEqual(theme.syntax.keyword.toInts())
    expect(color(syntax, "function")).toEqual(theme.syntax.function.toInts())
    expect(color(syntax, "variable")).toEqual(theme.syntax.variable.toInts())
    expect(color(syntax, "string")).toEqual(theme.syntax.string.toInts())
    expect(color(syntax, "number")).toEqual(theme.syntax.number.toInts())
    expect(color(syntax, "type")).toEqual(theme.syntax.type.toInts())
    expect(color(syntax, "operator")).toEqual(theme.syntax.operator.toInts())
    expect(color(syntax, "punctuation")).toEqual(theme.syntax.punctuation.toInts())
    expect(color(syntax, "markup.heading")).toEqual(theme.markdown.heading.toInts())
    expect(color(syntax, "markup.strong")).toEqual(theme.markdown.strong.toInts())
    expect(color(syntax, "markup.italic")).toEqual(theme.markdown.emphasis.toInts())
    expect(color(syntax, "markup.quote")).toEqual(theme.markdown.blockQuote.toInts())
    expect(color(syntax, "markup.raw.inline")).toEqual(theme.markdown.code.toInts())
    expect(background(syntax, "markup.raw.inline")).toEqual(theme.background.default.toInts())
    expect(color(syntax, "markup.link")).toEqual(theme.markdown.link.toInts())
    expect(color(syntax, "markup.link.label")).toEqual(theme.markdown.linkText.toInts())
    expect(color(syntax, "comment.error")).toEqual(theme.text.feedback.error.default.toInts())
    expect(color(syntax, "comment.warning")).toEqual(theme.text.feedback.warning.default.toInts())
    expect(color(syntax, "comment.todo")).toEqual(theme.text.feedback.info.default.toInts())
    expect(color(syntax, "markup.list.checked")).toEqual(theme.text.feedback.success.default.toInts())
    expect(color(syntax, "debug")).toEqual(theme.text.subdued.toInts())
    expect(color(syntax, "diff.plus")).toEqual(theme.diff.text.added.toInts())
    expect(background(syntax, "diff.plus")).toEqual(theme.diff.background.added.toInts())
    expect(syntax.getStyle("markup.heading.1")?.bold).toBeTrue()
    expect(syntax.getStyle("markup.heading.1")?.underline).toBeTrue()
  } finally {
    syntax.destroy()
  }
})

function color(syntax: ReturnType<typeof generateSyntax>, name: string) {
  return syntax.getStyle(name)?.fg?.toInts()
}

function background(syntax: ReturnType<typeof generateSyntax>, name: string) {
  return syntax.getStyle(name)?.bg?.toInts()
}
