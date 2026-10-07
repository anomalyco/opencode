import katex from "katex"
import type { MarkedExtension, Tokens } from "marked"
import markedKatex from "marked-katex-extension"
import markedShiki from "marked-shiki"
import { createMarkdownBase } from "./marked-base"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return createMarkdownBase().use(...markdownMath, markedShiki({ highlight }))
}

const inlineParenMathRegex = /^\\\(((?:\\.|[^\\\n])*?)\\\)/

// marked-katex-extension handles `$...$`, `$$...$$`, and `$$` fenced blocks; it has no `\(...\)` syntax.
export const markdownMath: MarkedExtension[] = [
  markedKatex({ throwOnError: false }),
  {
    extensions: [
      {
        name: "inlineParenKatex",
        level: "inline",
        start(src) {
          const index = src.indexOf("\\(")

          if (index === -1) return

          return index
        },
        tokenizer(src) {
          const match = src.match(inlineParenMathRegex)

          if (!match) return

          return {
            type: "inlineParenKatex",
            raw: match[0],
            text: match[1].trim(),
          }
        },
        renderer(token: Tokens.Generic) {
          return katex.renderToString(token.text, { throwOnError: false })
        },
      },
    ],
  },
]
