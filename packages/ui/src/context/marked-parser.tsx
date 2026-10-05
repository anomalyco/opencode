import katex from "katex"
import type { MarkedExtension, Tokens } from "marked"
import markedShiki from "marked-shiki"
import { createMarkdownBase } from "./marked-base"

export function createMarkdownParser(highlight: (code: string, language: string) => string | Promise<string>) {
  return createMarkdownBase().use(katexExtension, markedShiki({ highlight }))
}

const inlineMathRegex = /^\\\(((?:\\.|[^\\\n])*?)\\\)/
const dollarMathRegex = /^(\$+)(?!\s)((?:\\.|[^\n$])+?)\1(?!\d)/
const blockMathRegex = /^\$\$([\s\S]+?)\$\$(?:\n|$)/

const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const paren = src.indexOf("\\(")
        const dollar = src.indexOf("$")
        if (paren === -1) return dollar === -1 ? undefined : dollar
        if (dollar === -1) return paren
        return Math.min(paren, dollar)
      },
      tokenizer(src) {
        const match = src.match(inlineMathRegex)
        if (match)
          return {
            type: "inlineKatex",
            raw: match[0],
            text: match[1].trim(),
            displayMode: false,
          }
        const dollar = src.match(dollarMathRegex)
        if (!dollar || /\s$/.test(dollar[2]!)) return
        return {
          type: "inlineKatex",
          raw: dollar[0],
          text: dollar[2]!.trim(),
          displayMode: dollar[1]!.length === 2,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "blockKatex",
      level: "block",
      start(src) {
        const index = src.indexOf("\n$$")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const match = src.match(blockMathRegex)
        if (!match) return
        return {
          type: "blockKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: true,
        }
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
