import { codeToHtml, isSupportedLanguage } from "@pierre/highlights"
import katex from "katex"
import { Renderer, type MarkedExtension, type Tokens } from "marked"
import { createMarkdownBase } from "./marked-base"
import { OpenCodeTheme } from "./highlight-theme"

/** `render` places renderer output: `block` for a code block, `display` for a display formula inside a line. */
export function createMarkdownParser(
  render: (html: string, block: boolean, display?: boolean) => string = (html) => html,
) {
  return createMarkdownBase().use(
    mathExtension((token) => render(renderMath(token), false, token.displayMode === true)),
    codeExtension(render),
  )
}

const decoder = new TextDecoder()

// The class keeps the fence's own language, even one without a lexer, so the viewer can label it and render Mermaid.
function codeExtension(render: (html: string, block: boolean, display?: boolean) => string): MarkedExtension {
  const base = new Renderer()

  return {
    renderer: {
      checkbox(token) {
        return render(base.checkbox(token), false)
      },
      code(token) {
        // A math fence is a display formula, placed like one; a fence KaTeX cannot parse, such as one cut off
        // mid-formula, stays highlighted code.
        const formula = isMathFence(token.lang) && token.text.trim() ? renderFenceMath(token.text) : undefined

        if (formula !== undefined) return render(formula, false, true) + "\n"
        const language = (token.lang?.match(/^\S*/)?.[0] ?? "").toLowerCase().replace(/[^\w#+.-]/g, "") || "text"

        const html = decoder.decode(
          codeToHtml(token.text, { lang: isSupportedLanguage(language) ? language : "text", theme: OpenCodeTheme }),
        )

        return render(html.replace("<code>", `<code class="language-${language}">`), true) + "\n"
      },
    },
  }
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

const mathFenceLanguages = new Set(["latex", "math"])

/** Whether a fence's info string names display math, as ```` ```latex ```` and ```` ```math ```` do in the TUI. */
export function isMathFence(lang: string | undefined) {
  return mathFenceLanguages.has(lang?.match(/^\S*/)?.[0].toLowerCase() ?? "")
}

const katexLimits = { trust: false, maxSize: 10, maxExpand: 1000 }

function renderFenceMath(source: string) {
  try {
    return katex.renderToString(source, { ...katexLimits, throwOnError: true, displayMode: true })
  } catch {
    return undefined
  }
}

function renderMath(token: Tokens.Generic) {
  return katex.renderToString(token.text, { ...katexLimits, throwOnError: false, displayMode: token.displayMode })
}

function mathExtension(render: (token: Tokens.Generic) => string): MarkedExtension {
  return {
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
        renderer: render,
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
        renderer: render,
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
        renderer: (token) => render(token) + "\n",
      },
    ],
  }
}

export const markdownMath = mathExtension(renderMath)
