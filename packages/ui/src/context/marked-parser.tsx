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

const katexExtension: MarkedExtension = {
  extensions: [
    {
      name: "blockKatexDisplayDollar",
      level: "block",
      tokenizer(src) {
        const result = tryBlockDisplay(src, "$$")
        if (!result) return
        return {
          type: "blockKatexDisplayDollar",
          raw: result.raw,
          text: result.text,
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "blockKatexDisplayBracket",
      level: "block",
      tokenizer(src) {
        const result = tryBlockDisplay(src, "\\[")
        if (!result) return
        return {
          type: "blockKatexDisplayBracket",
          raw: result.raw,
          text: result.text,
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineKatexDisplayDollar",
      level: "inline",
      start(src) {
        const index = src.indexOf("$$")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const result = tryDisplayDollar(src)
        if (!result) return
        return {
          type: "inlineKatexDisplayDollar",
          raw: result.raw,
          text: result.text,
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineKatexDisplayBracket",
      level: "inline",
      start(src) {
        const index = src.indexOf("\\[")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const result = tryBracket(src)
        if (!result) return
        return {
          type: "inlineKatexDisplayBracket",
          raw: result.raw,
          text: result.text,
          displayMode: true,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineKatex",
      level: "inline",
      start(src) {
        const index = src.indexOf("\\(")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const result = tryParen(src)
        if (!result) return
        return {
          type: "inlineKatex",
          raw: result.raw,
          text: result.text,
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
    {
      name: "inlineKatexDollar",
      level: "inline",
      start(src) {
        const index = src.indexOf("$")
        if (index === -1) return
        return index
      },
      tokenizer(src) {
        const result = tryDollarSingle(src)
        if (!result) return
        return {
          type: "inlineKatexDollar",
          raw: result.raw,
          text: result.text,
          displayMode: false,
        }
      },
      renderer: renderKatexToken,
    },
  ],
}

function isEscaped(src: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && src[i] === "\\"; i--) backslashes++
  return backslashes % 2 === 1
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r"
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9"
}

function tryParen(src: string): { raw: string; text: string } | undefined {
  if (src[0] !== "\\" || src[1] !== "(") return
  for (let i = 2; i < src.length - 1; i++) {
    if (src[i] !== "\\" || src[i + 1] !== ")") continue
    if (isEscaped(src, i)) continue
    const text = src.slice(2, i).trim()
    if (!text) return
    return { raw: src.slice(0, i + 2), text }
  }
  return
}

function tryBracket(src: string): { raw: string; text: string } | undefined {
  if (src[0] !== "\\" || src[1] !== "[") return
  for (let i = 2; i < src.length - 1; i++) {
    if (src[i] !== "\\" || src[i + 1] !== "]") continue
    if (isEscaped(src, i)) continue
    const text = src.slice(2, i).trim()
    if (!text) return
    return { raw: src.slice(0, i + 2), text }
  }
  return
}

function tryDisplayDollar(src: string): { raw: string; text: string } | undefined {
  if (src[0] !== "$" || src[1] !== "$") return
  for (let i = 2; i < src.length - 1; i++) {
    if (src[i] !== "$" || src[i + 1] !== "$") continue
    if (isEscaped(src, i)) continue
    const text = src.slice(2, i).trim()
    if (!text) return
    return { raw: src.slice(0, i + 2), text }
  }
  return
}

function tryDollarSingle(src: string): { raw: string; text: string } | undefined {
  if (src[0] !== "$") return
  // Let $$ display handling take precedence.
  if (src[1] === "$") return
  // Opening $ must not be followed by whitespace (avoids currency like "$ 5").
  if (isWhitespace(src[1])) return
  if (src[1] === undefined) return
  for (let i = 1; i < src.length; i++) {
    if (src[i] !== "$") continue
    if (isEscaped(src, i)) continue
    // Skip $ that is part of $$ (display math takes precedence).
    if (src[i - 1] === "$" || src[i + 1] === "$") continue
    // Closing $ must not be preceded by whitespace (avoids "$5 and $" currency ranges).
    if (isWhitespace(src[i - 1])) continue
    const text = src.slice(1, i)
    if (!text || !text.trim()) continue
    // Content must not contain another $ (keeps "$5, blah $x$" from merging).
    if (text.includes("$")) return
    // Closing $ followed by a digit is likely currency ("$5,$6"), not math.
    if (isDigit(src[i + 1])) continue
    return { raw: src.slice(0, i + 1), text: text.trim() }
  }
  return
}

function tryBlockDisplay(src: string, opening: "$$" | "\\["): { raw: string; text: string } | undefined {
  const match = src.match(/^ {0,3}(\$\$|\\\[)/)
  if (!match) return
  const leading = match[0].length - match[1].length
  const rest = src.slice(leading)
  if (opening === "$$" && !rest.startsWith("$$")) return
  if (opening === "\\[" && !rest.startsWith("\\[")) return
  const result = opening === "$$" ? tryDisplayDollar(rest) : tryBracket(rest)
  if (!result) return
  return { raw: src.slice(0, leading + result.raw.length), text: result.text }
}

function renderKatexToken(token: Tokens.Generic) {
  return katex.renderToString(typeof token.text === "string" ? token.text : "", {
    displayMode: token.displayMode === true,
    throwOnError: false,
  })
}
