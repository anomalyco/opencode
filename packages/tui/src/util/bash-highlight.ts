import type { SimpleHighlight } from "@opentui/core"

// nvim-treesitter's bash query narrows three captures with #lua-match?, a Neovim predicate that
// web-tree-sitter does not evaluate, so every word would come back as a number and every variable
// as a constant. These are those patterns, widened to the other captures sharing the group name:
// number nodes in arithmetic and special variables such as $? and $@.
const NARROWED: Record<string, RegExp> = {
  number: /^[-+]?(0x[\da-f]+|\d+(#\w+)?)$/i,
  constant: /^([A-Z][A-Z_0-9]*|[*@?!#$0_-])$/,
  "keyword.directive": /^#!\//,
}

// The query also tags comments `@comment @spell`, and the theme colors spell as plain text, which
// would override the comment color. Spell marks text for a spell checker, not for color.
const SPELL = new Set(["spell", "nospell"])

export function narrowBashHighlights(highlights: SimpleHighlight[], content: string) {
  return highlights.filter(
    ([start, end, group]) => !SPELL.has(group) && (NARROWED[group]?.test(content.slice(start, end)) ?? true),
  )
}
