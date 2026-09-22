import { SyntaxStyle, type RGBA, type ThemeTokenStyle } from "@opentui/core"
import type { ResolvedThemeTokens } from "./index.js"

export function generateSyntax(theme: ResolvedThemeTokens) {
  const step = 200
  const syntax = theme.syntax
  const markdown = theme.markdown
  const feedback = theme.text.feedback

  return SyntaxStyle.fromTheme([
    rule(["default"], theme.text.base),
    rule(["prompt"], theme.hue.accent[step]),
    rule(["extmark.file"], feedback.warning.base, { bold: true }),
    rule(["extmark.agent"], theme.categorical[0][step], { bold: true }),
    rule(["extmark.skill"], (theme.categorical[1] ?? theme.categorical[0])[step], { bold: true }),
    // V1 migration preserves its selected/inverse foreground in this action state.
    rule(["extmark.paste"], theme.text.action.primary.focused, {
      background: feedback.warning.base,
      bold: true,
    }),
    rule(["comment", "comment.documentation"], syntax.comment, { italic: true }),
    rule(["string", "symbol", "character.special", "character"], syntax.string),
    rule(["number", "boolean", "constant", "float"], syntax.number),
    rule(["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], syntax.keyword, {
      italic: true,
    }),
    rule(["keyword.type"], syntax.type, { bold: true, italic: true }),
    rule(["keyword.function", "function.method"], syntax.function),
    rule(["keyword"], syntax.keyword, { italic: true }),
    rule(["keyword.import", "string.escape", "string.regexp", "tag.attribute", "keyword.export"], syntax.keyword),
    rule(["operator", "keyword.operator", "punctuation.delimiter", "keyword.conditional.ternary"], syntax.operator),
    rule(
      ["variable", "variable.parameter", "function.method.call", "function.call", "property", "parameter", "field"],
      syntax.variable,
    ),
    rule(["variable.member", "function", "constructor"], syntax.function),
    rule(["type", "module", "class", "namespace"], syntax.type),
    rule(["type.definition"], syntax.type, { bold: true }),
    rule(["punctuation", "punctuation.bracket"], syntax.punctuation),
    rule(
      ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin", "variable.super"],
      feedback.error.base,
    ),
    rule(["keyword.directive", "keyword.modifier", "keyword.exception"], syntax.keyword, { italic: true }),
    rule(["punctuation.special", "tag.delimiter"], syntax.operator),
    rule(
      [
        "markup.heading",
        "markup.heading.2",
        "markup.heading.3",
        "markup.heading.4",
        "markup.heading.5",
        "markup.heading.6",
      ],
      markdown.heading,
      { bold: true },
    ),
    rule(["markup.heading.1"], markdown.heading, { bold: true, underline: true }),
    rule(["markup.bold", "markup.strong"], markdown.strong, { bold: true }),
    rule(["markup.italic"], markdown.emphasis, { italic: true }),
    rule(["markup.list"], markdown.listItem),
    rule(["markup.quote"], markdown.blockQuote, { italic: true }),
    rule(["markup.raw", "markup.raw.block"], markdown.code),
    rule(["markup.raw.inline"], markdown.code, { background: theme.background.base }),
    rule(["markup.link", "markup.link.url", "string.special", "string.special.url"], markdown.link, {
      underline: true,
    }),
    rule(["markup.link.label"], markdown.linkText, { underline: true }),
    rule(["label"], markdown.linkText),
    rule(["spell", "nospell"], theme.text.base),
    rule(["markup.underline"], theme.text.base, { underline: true }),
    rule(["comment.error"], feedback.error.base, { italic: true, bold: true }),
    rule(["comment.warning"], feedback.warning.base, { italic: true, bold: true }),
    rule(["comment.todo", "comment.note"], feedback.info.base, { italic: true, bold: true }),
    rule(["attribute", "annotation"], feedback.warning.base),
    rule(["tag"], feedback.error.base),
    rule(["markup.strikethrough", "markup.list.unchecked", "debug"], theme.text.muted),
    rule(["markup.list.checked"], feedback.success.base),
    rule(["diff.plus"], theme.diff.text.added, { background: theme.diff.background.added }),
    rule(["diff.minus"], theme.diff.text.removed, { background: theme.diff.background.removed }),
    rule(["diff.delta"], theme.diff.text.context, { background: theme.diff.background.context }),
    rule(["error"], feedback.error.base, { bold: true }),
    rule(["warning"], feedback.warning.base, { bold: true }),
    rule(["info"], feedback.info.base),
  ])
}

function rule(
  scope: string[],
  foreground: RGBA,
  style: Omit<ThemeTokenStyle["style"], "foreground"> = {},
): ThemeTokenStyle {
  return { scope, style: { foreground, ...style } }
}
