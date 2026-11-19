import { codeToHtml, isSupportedLanguage } from "@pierre/highlights"
import katex from "katex"
import type { MarkedExtension, Tokens } from "marked"
import { createMarkdownBase } from "./marked-base"
import { OpenCodeTheme } from "./highlight-theme"

export function createMarkdownParser() {
  return createMarkdownBase().use(markdownCode, markdownMath)
}

const decoder = new TextDecoder()

// The class keeps the fence's own language, even one without a lexer, so the viewer can label it and render Mermaid.
const markdownCode: MarkedExtension = {
  renderer: {
    code(token) {
      const language = (token.lang?.match(/^\S*/)?.[0] ?? "").toLowerCase().replace(/[^\w#+.-]/g, "") || "text"

      const html = decoder.decode(
        codeToHtml(token.text, { lang: isSupportedLanguage(language) ? language : "text", theme: OpenCodeTheme }),
      )

      return html.replace("<code>", `<code class="language-${language}">`) + "\n"
    },
  },
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

const mathFenceLanguages = new Set(["latex", "math"])

/** Whether a fence's info string names display math, as ```` ```latex ```` and ```` ```math ```` do in the TUI. */
export function isMathFence(lang: string | undefined) {
  return mathFenceLanguages.has(lang?.match(/^\S*/)?.[0].toLowerCase() ?? "")
}

export const markdownMath: MarkedExtension = {
  renderer: {
    // A math fence KaTeX cannot parse, such as one cut off mid-formula, stays highlighted code.
    code(token) {
      if (!isMathFence(token.lang) || !token.text.trim()) return false

      try {
        return katex.renderToString(token.text, { throwOnError: true, displayMode: true }) + "\n"
      } catch {
        return false
      }
    },
  },
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
