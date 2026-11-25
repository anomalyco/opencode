import { decodeEntity, ENTITY_PATTERN } from "@opencode/patchmark"
import type { Token, Tokens } from "marked"

const ENTITY = new RegExp(ENTITY_PATTERN, "gi")

const HTML_TAG = /<!--[\s\S]*?-->|<[^>]*>/g

// Fences that are drawn, not shown as their source: a diagram, and display math.
const DRAWN_FENCE = /^(?:mermaid|latex|math)$/i

/**
 * The text a Markdown source shows once it is rendered, one line a block: what a reader can find in it. It reads the
 * tokens of the parser that renders the source, because another parser disagrees on what is Markdown: a raw tag line
 * after a list item is an HTML block to marked, and the asterisks after it stay on screen.
 * Markers, link destinations, image sources and formulas are not in the text, an entity reads as its character, and a
 * phrase that runs across bold, a link or the tokens of a code block is whole. A block ends its line, so nothing is
 * found across two blocks.
 */
export function markdownText(tokens: readonly Token[]) {
  return tokens.flatMap(lines).join("\n")
}

function lines(token: Token): string[] {
  if (token.type === "paragraph" || token.type === "heading" || token.type === "text")
    return [inline(token.tokens ?? [])]

  if (token.type === "code") {
    const code = token as Tokens.Code

    return DRAWN_FENCE.test(code.lang?.match(/^\S*/)?.[0] ?? "") ? [] : [code.text]
  }

  if (token.type === "blockquote") return (token.tokens ?? []).flatMap(lines)

  if (token.type === "list") return (token as Tokens.List).items.flatMap((item) => item.tokens.flatMap(lines))

  if (token.type === "table") {
    const table = token as Tokens.Table

    return [...table.header, ...table.rows.flat()].map((cell) => inline(cell.tokens))
  }

  // Raw HTML goes to the page as it is. Each tag ends a line: most tags of a raw block are blocks themselves.
  if (token.type === "html") return [decode((token as Tokens.HTML).text.replace(HTML_TAG, "\n"))]

  // A formula, a rule, a link definition and the space between blocks show no text.
  return []
}

function inline(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "text") return token.tokens ? inline(token.tokens) : decode((token as Tokens.Text).text)

      // A backslash escape is its character, and code is shown as it is written.
      if (token.type === "escape" || token.type === "codespan") return (token as Tokens.Escape | Tokens.Codespan).text

      if (token.type === "strong" || token.type === "em" || token.type === "del" || token.type === "link")
        return inline(token.tokens ?? [])

      if (token.type === "br") return "\n"

      // A raw tag shows nothing itself. A line break ends the line.
      if (token.type === "html") return /^<br\b/i.test((token as Tokens.Tag).text) ? "\n" : ""

      // An image and a formula show none of their source.
      return ""
    })
    .join("")
}

// Text that reaches the page as HTML: the browser reads its entities.
function decode(text: string) {
  return text.includes("&") ? text.replace(ENTITY, decodeEntity) : text
}
