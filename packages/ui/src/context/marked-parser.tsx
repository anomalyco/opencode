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

const inlineMathRegex = /^\\\(((?:\\.|[^\\\n])*?)\\\)/
const blockMathRegex = /^\$\$\n([\s\S]+?)\n\$\$(?:\n|$)/
// 单美元行内公式:$...$,支持 \$ 转义,不允许换行
const inlineDollarRegex = /^\$((?:\\\$|[^$\n])+)\$/
// 行内双美元公式:$$...$$(非独占段落时使用),支持 \$ 转义
const inlineDoubleDollarRegex = /^\$\$((?:\\\$|[^$\n])+)\$\$/

const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const index = src.indexOf("\\(")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const match = src.match(inlineMathRegex)
        if (!match) return
        return {
          type: "inlineKatex",
          raw: match[0],
          text: match[1].trim(),
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineDoubleDollarKatex",
      level: "inline",
      start(src) {
        const index = src.indexOf("$$")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        if (!src.startsWith("$$")) return
        const rest = src.slice(2)
        if (rest.length === 0) return
        if (/^\d/.test(rest) && !/^[\d.]*[()]/.test(rest)) return
        if (/^\s/.test(rest)) return
        const match = src.match(inlineDoubleDollarRegex)
        if (!match) return
        const body = match[1].trim()
        if (!body) return
        return {
          type: "inlineDoubleDollarKatex",
          raw: match[0],
          text: body,
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineDollarKatex",
      level: "inline",
      start(src) {
        const index = src.indexOf("$")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        if (!src.startsWith("$")) return
        // 货币/占位符保护:$ 后跟数字+空格/单位($5 today、$0.02/GB)不视为公式;
        // 但 $2(... 这类公式(如 $2(L_{ur}-L_r)$)应正常渲染
        const rest = src.slice(1)
        if (rest.length === 0) return
        if (/^\d/.test(rest) && !/^[\d.]*[()]/.test(rest)) return
        if (/^\s/.test(rest)) return
        const match = src.match(inlineDollarRegex)
        if (!match) return
        const body = match[1].trim()
        if (!body) return
        return {
          type: "inlineDollarKatex",
          raw: match[0],
          text: body,
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
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
