import katex from "katex"
import { Marked, type MarkedExtension, type Tokens } from "marked"
import markedShiki from "marked-shiki"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return new Marked(
    {
      renderer: {
        link({ href, title, text }) {
          const titleAttr = title ? ` title="${title}"` : ""
          return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
        },
      },
    },
    katexExtension,
    markedShiki({ highlight }),
  )
}

const inlineParenMath = /^\\\(((?:\\.|[^\\\n])*?)\\\)/
const inlineBracketMath = /^\\\[((?:\\.|[^\\\n])+?)\\\]/
const inlineDoubleDollarMath = /^\$\$([^\n]+?)\$\$/
const inlineDollarMath = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/
const blockBracketMath = /^\\\[[ \t]*\n?([\s\S]+?)\n?[ \t]*\\\](?:\n|$)/
const blockDollarMath = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:\n|$)/

const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const indexes = [src.indexOf("\\("), src.indexOf("\\["), src.indexOf("$")].filter((index) => index !== -1)
        if (indexes.length === 0) return
        return Math.min(...indexes)
      },
      tokenizer(src) {
        const paren = src.match(inlineParenMath)
        if (paren) return { type: "inlineKatex", raw: paren[0], text: paren[1].trim(), displayMode: false }

        const bracket = src.match(inlineBracketMath)
        if (bracket) return { type: "inlineKatex", raw: bracket[0], text: bracket[1].trim(), displayMode: true }

        const double = src.match(inlineDoubleDollarMath)
        if (double) return { type: "inlineKatex", raw: double[0], text: double[1].trim(), displayMode: true }

        const single = src.match(inlineDollarMath)
        if (single) return { type: "inlineKatex", raw: single[0], text: single[1].trim(), displayMode: false }
        return
      },
      renderer: renderKatexToken,
    },
    {
      name: "blockKatex",
      level: "block",
      tokenizer(src) {
        const bracket = src.match(blockBracketMath)
        if (bracket) return { type: "blockKatex", raw: bracket[0], text: bracket[1].trim(), displayMode: true }

        const dollar = src.match(blockDollarMath)
        if (dollar) return { type: "blockKatex", raw: dollar[0], text: dollar[1].trim(), displayMode: true }
        return
      },
      renderer: renderKatexToken,
    },
  ],
}

function renderKatexToken(token: Tokens.Generic) {
  return katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
}
