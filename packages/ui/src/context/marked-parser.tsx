import katex from "katex"
import type { MarkedExtension, Tokens } from "marked"
import markedShiki from "marked-shiki"
import { createMarkdownBase } from "./marked-base"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return createMarkdownBase().use(markdownMath, markedShiki({ highlight }))
}

// `$$...$$` renders as display math anywhere in a line.
// `$...$` follows Pandoc's boundaries so prices and shell variables stay text: the opening `$` needs a non-space
// after it, the closing `$` needs a non-space before it and no letter, digit, or underscore after it.
// Neither form spans a newline, and `$...$` cannot contain an unescaped `$`, so a failed `$...$` attempt stops at
// the next `$` and a failed `$$...$$` attempt stops at the end of the line.
const inlineDollarMathRegex =
  /\$\$(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\$\$|\$(?=[^\s$])((?:\\.|[^\\\n$])*?(?:\\\S|[^\s\\$]))\$(?!\w)/y

const inlineParenMathRegex = /^\\\(((?:\\.|[^\\\n])*?)\\\)/

const blockMathRegex = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/

function renderMath(token: Tokens.Generic) {
  return katex.renderToString(token.text, { throwOnError: false, displayMode: token.displayMode })
}

export const markdownMath: MarkedExtension = {
  extensions: [
    {
      name: "inlineDollarKatex",
      level: "inline",
      // marked calls `start` again for every text token with the rest of the paragraph, so it must not try the
      // regex at each `$`; a `$` that fails the tokenizer just stays in the merged text.
      start(src) {
        const index = src.indexOf("$")

        if (index === -1) return

        return index
      },
      tokenizer(src) {
        inlineDollarMathRegex.lastIndex = 0
        const match = inlineDollarMathRegex.exec(src)

        if (!match) return

        return {
          type: "inlineDollarKatex",
          raw: match[0],
          text: (match[1] ?? match[2]).trim(),
          displayMode: match[1] !== undefined,
        }
      },
      renderer: renderMath,
    },
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
          displayMode: false,
        }
      },
      renderer: renderMath,
    },
    {
      name: "blockKatex",
      level: "block",
      tokenizer(src) {
        const match = src.match(blockMathRegex)

        if (!match) return

        return {
          type: "blockKatex",
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        }
      },
      renderer: (token) => renderMath(token) + "\n",
    },
  ],
}
