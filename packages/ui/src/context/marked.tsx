import { Marked } from "marked"
import markedKatex from "marked-katex-extension"
import markedShiki from "marked-shiki"
import katex from "katex"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { getSharedHighlighter, registerCustomTheme, ThemeRegistrationResolved } from "@pierre/diffs"

type MathOutput = "html" | "htmlAndMathml"

const autoLinkBoundaryChars = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  "\v",
  ",",
  ".",
  ";",
  ":",
  "!",
  "?",
  ")",
  "]",
  "}",
  ">",
  "，",
  "。",
  "；",
  "：",
  "！",
  "？",
  "、",
  "）",
  "］",
  "】",
  "｝",
  "〉",
  "》",
  "」",
  "』",
])

function trimAutolinkAtBoundary(value: string) {
  for (let i = 0; i < value.length; i++) {
    if (autoLinkBoundaryChars.has(value[i])) return value.slice(0, i)
  }
  return value
}

function normalizeAutolink(href: string, text: string) {
  const hrefTrimmed = href.trim()
  const textTrimmed = text.trim()
  if (!hrefTrimmed.startsWith("http://") && !hrefTrimmed.startsWith("https://")) return
  if (textTrimmed !== hrefTrimmed) return

  const nextHref = trimAutolinkAtBoundary(hrefTrimmed)
  if (!nextHref || nextHref === hrefTrimmed) return

  try {
    const parsed = new URL(nextHref)
    return {
      href: parsed.toString(),
      text: trimAutolinkAtBoundary(textTrimmed),
    }
  } catch {
    return
  }
}

registerCustomTheme("OpenCode", () => {
  return Promise.resolve({
    name: "OpenCode",
    colors: {
      "editor.background": "var(--color-background-stronger)",
      "editor.foreground": "var(--text-base)",
      "gitDecoration.addedResourceForeground": "var(--syntax-diff-add)",
      "gitDecoration.deletedResourceForeground": "var(--syntax-diff-delete)",
      // "gitDecoration.conflictingResourceForeground": "#ffca00",
      // "gitDecoration.modifiedResourceForeground": "#1a76d4",
      // "gitDecoration.untrackedResourceForeground": "#00cab1",
      // "gitDecoration.ignoredResourceForeground": "#84848A",
      // "terminal.titleForeground": "#adadb1",
      // "terminal.titleInactiveForeground": "#84848A",
      // "terminal.background": "#141415",
      // "terminal.foreground": "#adadb1",
      // "terminal.ansiBlack": "#141415",
      // "terminal.ansiRed": "#ff2e3f",
      // "terminal.ansiGreen": "#0dbe4e",
      // "terminal.ansiYellow": "#ffca00",
      // "terminal.ansiBlue": "#008cff",
      // "terminal.ansiMagenta": "#c635e4",
      // "terminal.ansiCyan": "#08c0ef",
      // "terminal.ansiWhite": "#c6c6c8",
      // "terminal.ansiBrightBlack": "#141415",
      // "terminal.ansiBrightRed": "#ff2e3f",
      // "terminal.ansiBrightGreen": "#0dbe4e",
      // "terminal.ansiBrightYellow": "#ffca00",
      // "terminal.ansiBrightBlue": "#008cff",
      // "terminal.ansiBrightMagenta": "#c635e4",
      // "terminal.ansiBrightCyan": "#08c0ef",
      // "terminal.ansiBrightWhite": "#c6c6c8",
    },
    tokenColors: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: {
          foreground: "var(--syntax-comment)",
        },
      },
      {
        scope: ["entity.other.attribute-name"],
        settings: {
          foreground: "var(--syntax-property)", // maybe attribute
        },
      },
      {
        scope: ["constant", "entity.name.constant", "variable.other.constant", "variable.language", "entity"],
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: ["entity.name", "meta.export.default", "meta.definition.variable"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: ["meta.object.member"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "variable.parameter.function",
          "meta.jsx.children",
          "meta.block",
          "meta.tag.attributes",
          "entity.name.constant",
          "meta.embedded.expression",
          "meta.template.expression",
          "string.other.begin.yaml",
          "string.other.end.yaml",
        ],
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["entity.name.function", "support.type.primitive"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.class.component"],
        settings: {
          foreground: "var(--syntax-type)",
        },
      },
      {
        scope: "keyword",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: [
          "keyword.operator",
          "storage.type.function.arrow",
          "punctuation.separator.key-value.css",
          "entity.name.tag.yaml",
          "punctuation.separator.key-value.mapping.yaml",
        ],
        settings: {
          foreground: "var(--syntax-operator)",
        },
      },
      {
        scope: ["storage", "storage.type"],
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: ["storage.modifier.package", "storage.modifier.import", "storage.type.java"],
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: [
          "string",
          "punctuation.definition.string",
          "string punctuation.section.embedded source",
          "entity.name.tag",
        ],
        settings: {
          foreground: "var(--syntax-string)",
        },
      },
      {
        scope: "support",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: ["support.type.object.module", "variable.other.object", "support.type.property-name.css"],
        settings: {
          foreground: "var(--syntax-object)",
        },
      },
      {
        scope: "meta.property-name",
        settings: {
          foreground: "var(--syntax-property)",
        },
      },
      {
        scope: "variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "variable.other",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: [
          "invalid.broken",
          "invalid.illegal",
          "invalid.unimplemented",
          "invalid.deprecated",
          "message.error",
          "markup.deleted",
          "meta.diff.header.from-file",
          "punctuation.definition.deleted",
          "brackethighlighter.unmatched",
          "token.error-token",
        ],
        settings: {
          foreground: "var(--syntax-critical)",
        },
      },
      {
        scope: "carriage-return",
        settings: {
          foreground: "var(--syntax-keyword)",
        },
      },
      {
        scope: "string source",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "string variable",
        settings: {
          foreground: "var(--syntax-constant)",
        },
      },
      {
        scope: [
          "source.regexp",
          "string.regexp",
          "string.regexp.character-class",
          "string.regexp constant.character.escape",
          "string.regexp source.ruby.embedded",
          "string.regexp string.regexp.arbitrary-repitition",
          "string.regexp constant.character.escape",
        ],
        settings: {
          foreground: "var(--syntax-regexp)",
        },
      },
      {
        scope: "support.constant",
        settings: {
          foreground: "var(--syntax-primitive)",
        },
      },
      {
        scope: "support.variable",
        settings: {
          foreground: "var(--syntax-variable)",
        },
      },
      {
        scope: "meta.module-reference",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "punctuation.definition.list.begin.markdown",
        settings: {
          foreground: "var(--syntax-punctuation)",
        },
      },
      {
        scope: ["markup.heading", "markup.heading entity.name"],
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.quote",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "markup.italic",
        settings: {
          fontStyle: "italic",
          // foreground: "",
        },
      },
      {
        scope: "markup.bold",
        settings: {
          fontStyle: "bold",
          foreground: "var(--text-strong)",
        },
      },
      {
        scope: [
          "markup.raw",
          "markup.inserted",
          "meta.diff.header.to-file",
          "punctuation.definition.inserted",
          "markup.changed",
          "punctuation.definition.changed",
          "markup.ignored",
          "markup.untracked",
        ],
        settings: {
          foreground: "var(--text-base)",
        },
      },
      {
        scope: "meta.diff.range",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.diff.header",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.separator",
        settings: {
          fontStyle: "bold",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.output",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "meta.export.default",
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: [
          "brackethighlighter.tag",
          "brackethighlighter.curly",
          "brackethighlighter.round",
          "brackethighlighter.square",
          "brackethighlighter.angle",
          "brackethighlighter.quote",
        ],
        settings: {
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: ["constant.other.reference.link", "string.other.link"],
        settings: {
          fontStyle: "underline",
          foreground: "var(--syntax-unknown)",
        },
      },
      {
        scope: "token.info-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
      {
        scope: "token.warn-token",
        settings: {
          foreground: "var(--syntax-warning)",
        },
      },
      {
        scope: "token.debug-token",
        settings: {
          foreground: "var(--syntax-info)",
        },
      },
    ],
    semanticTokenColors: {
      comment: "var(--syntax-comment)",
      string: "var(--syntax-string)",
      number: "var(--syntax-constant)",
      regexp: "var(--syntax-regexp)",
      keyword: "var(--syntax-keyword)",
      variable: "var(--syntax-variable)",
      parameter: "var(--syntax-variable)",
      property: "var(--syntax-property)",
      function: "var(--syntax-primitive)",
      method: "var(--syntax-primitive)",
      type: "var(--syntax-type)",
      class: "var(--syntax-type)",
      namespace: "var(--syntax-type)",
      enumMember: "var(--syntax-primitive)",
      "variable.constant": "var(--syntax-constant)",
      "variable.defaultLibrary": "var(--syntax-unknown)",
    },
  } as unknown as ThemeRegistrationResolved)
})

function unescapeHtmlEntities(text: string): string {
  return text
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#92;/g, "\\")
    .replace(/&#39;/g, "'")
}

function stripEquationNumbers(math: string): string {
  return math
    .replace(/\\begin\{(align|equation|gather|eqnarray)\}/g, "\\begin{$1*}")
    .replace(/\\end\{(align|equation|gather|eqnarray)\}/g, "\\end{$1*}")
}

function stripMathHtml(text: string): string {
  return text
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim()
}

function escapeMathHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\\/g, "&#92;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function mathPlaceholder(math: string, style: "display" | "inline") {
  const tag = style === "display" ? "div" : "span"
  return `<${tag} data-opencode-math-style="${style}" data-opencode-math-tex="${escapeMathHtml(math)}"></${tag}>`
}

export function protectMathExpressions(markdown: string): string {
  const block = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g
  const parts = markdown.split(block)

  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      const displayProtected = part
        .replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
          const clean = math.trim()
          return clean ? `\n\n${mathPlaceholder(clean, "display")}\n\n` : "$$$$"
        })
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
          const clean = math.trim()
          return clean ? `\n\n${mathPlaceholder(clean, "display")}\n\n` : "\\[\\]"
        })
      return protectInlineMath(displayProtected)
    })
    .join("")
}

function escapedDollar(text: string, at: number) {
  let slash = 0
  for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) slash++
  return slash % 2 === 1
}

function rawInlineMathEnd(text: string, from: number) {
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (ch === "<") {
      const close = text.indexOf(">", i + 1)
      if (close === -1) return
      i = close
      continue
    }
    if (ch !== "$" || escapedDollar(text, i)) continue
    if (text[i + 1] === "$") {
      i++
      continue
    }
    if (/\s/.test(text[i - 1] ?? "")) continue
    return i
  }
}

function inlineCodeEnd(text: string, at: number) {
  if (text[at] !== "`") return
  let size = 0
  while (text[at + size] === "`") size++
  const mark = "`".repeat(size)
  const end = text.indexOf(mark, at + size)
  if (end === -1) return
  return end + size
}

function protectInlineMath(text: string) {
  let out = ""
  let from = 0

  for (let i = 0; i < text.length; i++) {
    const code = inlineCodeEnd(text, i)
    if (code) {
      out += text.slice(from, code)
      i = code - 1
      from = code
      continue
    }

    const ch = text[i]
    if (ch === "<") {
      const close = text.indexOf(">", i + 1)
      if (close === -1) break
      i = close
      continue
    }
    if (ch !== "$" || escapedDollar(text, i)) continue
    if (text[i + 1] === "$") {
      const end = text.indexOf("$$", i + 2)
      if (end === -1) continue
      i = end + 1
      continue
    }
    if (/\s/.test(text[i + 1] ?? "")) continue

    const end = rawInlineMathEnd(text, i + 1)
    if (!end) continue

    const math = text.slice(i + 1, end)
    if (!math.trim()) continue
    out += text.slice(from, i)
    out += mathPlaceholder(math, "inline")
    i = end
    from = end + 1
  }

  if (from === 0) return text
  return out + text.slice(from)
}

function renderMathInText(text: string, output: MathOutput): string {
  const addDisplayMathTex = (html: string, latex: string) => {
    return html.replace(
      /^<span class="([^"]*\bkatex-display\b[^"]*)"/,
      `<span class="$1" data-opencode-math-tex="${escapeMathHtml(latex)}"`,
    )
  }

  const render = (math: string, displayMode: boolean, fallback: string) => {
    try {
      const latex = unescapeHtmlEntities(math)
      const rendered = katex.renderToString(
        displayMode ? stripEquationNumbers(latex) : latex,
        {
          displayMode,
          output,
          throwOnError: false,
        },
      )
      return displayMode ? addDisplayMathTex(rendered, latex) : rendered
    } catch {
      return fallback
    }
  }

  let result = text

  result = result.replace(
    /<(span|div) data-opencode-math-style="(inline|display)" data-opencode-math-tex="([^"]*)"[^>]*><\/\1>/g,
    (_, _tag, style: "inline" | "display", math) => {
      const displayMode = style === "display"
      return render(math, displayMode, displayMode ? `$$${math}$$` : `$${math}$`)
    },
  )

  result = result.replace(/<div data-opencode-math-style="display">([\s\S]*?)<\/div>/g, (_, math) =>
    render(math, true, `$$${math}$$`),
  )

  // Display math: <span data-math-style="display">...</span> (from comrak math_dollars)
  result = result.replace(/<span data-math-style="display">([\s\S]*?)<\/span>/g, (_, math) =>
    render(math, true, `$$${math}$$`),
  )

  // Inline math: <span data-math-style="inline">...</span> (from comrak math_dollars)
  result = result.replace(/<span data-math-style="inline">([\s\S]*?)<\/span>/g, (_, math) =>
    render(math, false, `$${math}$`),
  )

  // Fallback for native parsers that keep raw display delimiters.
  // Allow matches across parser-inserted tags, then strip tags from math payload.
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const clean = stripMathHtml(math)
    if (!clean) return `$$${math}$$`
    return render(clean, true, `$$${math}$$`)
  })
  result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const clean = stripMathHtml(math)
    if (!clean) return `\\[${math}\\]`
    return render(clean, true, `\\[${math}\\]`)
  })

  return result
}

export function renderMathExpressions(html: string, output: MathOutput): string {
  // Split on code/pre/kbd tags to avoid processing their contents
  const codeBlockPattern = /(<(?:pre|code|kbd)[^>]*>[\s\S]*?<\/(?:pre|code|kbd)>)/gi
  const parts = html.split(codeBlockPattern)

  return parts
    .map((part, i) => {
      // Odd indices are the captured code blocks - leave them alone
      if (i % 2 === 1) return part
      // Process math only in non-code parts
      return renderMathInText(part, output)
    })
    .join("")
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g
  const matches = [...html.matchAll(codeBlockRegex)]
  if (matches.length === 0) return html

  const timeoutMs = 6_000
  try {
    const result = await Promise.race([
      (async () => {
        const highlighter = await getSharedHighlighter({
          themes: ["OpenCode"],
          langs: [],
          preferredHighlighter: "shiki-wasm",
        })

        let output = html
        for (const match of matches) {
          const [fullMatch, lang, escapedCode] = match
          const code = unescapeHtmlEntities(escapedCode)

          let language = lang || "text"
          if (!(language in bundledLanguages)) {
            language = "text"
          }
          if (!highlighter.getLoadedLanguages().includes(language)) {
            await highlighter.loadLanguage(language as BundledLanguage)
          }

          const highlighted = highlighter.codeToHtml(code, {
            lang: language,
            theme: "OpenCode",
            tabindex: false,
          })
          output = output.replace(fullMatch, () => highlighted)
        }
        return output
      })(),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(html), timeoutMs),
      ),
    ])
    return result
  } catch {
    return html
  }
}

export type NativeMarkdownParser = (markdown: string) => Promise<string>

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: (props: { nativeParser?: NativeMarkdownParser; mathOutput?: MathOutput }) => {
    const output = props.mathOutput ?? "htmlAndMathml"
    const native = props.nativeParser

    const highlightTimeoutMs = 6_000
    const plainCode = (code: string, lang?: string) => {
      const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      return `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escaped}</code></pre>`
    }

    const highlight = async (code: string, lang?: string) => {
      try {
        const result = await Promise.race([
          (async () => {
            const highlighter = await getSharedHighlighter({
              themes: ["OpenCode"],
              langs: [],
              preferredHighlighter: "shiki-wasm",
            })
            const value = lang && lang in bundledLanguages ? lang : "text"
            if (!highlighter.getLoadedLanguages().includes(value)) {
              await highlighter.loadLanguage(value as BundledLanguage)
            }
            return highlighter.codeToHtml(code, {
              lang: value,
              theme: "OpenCode",
              tabindex: false,
            })
          })(),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(plainCode(code, lang)), highlightTimeoutMs),
          ),
        ])
        return result
      } catch {
        return plainCode(code, lang)
      }
    }

    const linkRenderer = {
      renderer: {
        link({ href, title, text }: { href: string; title?: string | null; text: string }) {
          const normalized = href ? normalizeAutolink(href, text) : undefined
          const safeHref = normalized?.href ?? href
          const safeText = normalized?.text ?? text
          const titleAttr = title ? ` title="${title}"` : ""
          return `<a href="${safeHref}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${safeText}</a>`
        },
      },
    }

    const liteParser = new Marked(linkRenderer)
    const noMathParser = new Marked(
      linkRenderer,
      markedShiki({
        async highlight(code, lang) {
          return highlight(code, lang)
        },
      }),
    )

    // Full parser with shiki highlighting — used for final render
    const fullParser = new Marked(
      linkRenderer,
      markedKatex({
        output,
        throwOnError: false,
        strict: "ignore",
        nonStandard: true,
      }),
      markedShiki({
        async highlight(code, lang) {
          return highlight(code, lang)
        },
      }),
    )

    // Fast parser skips both shiki and KaTeX so first paint stays cheap.
    // The renderer upgrades to the full parser later when needed.
    const fastParser = new Marked(linkRenderer)

    if (native) {
      return {
        async parse(markdown: string): Promise<string> {
          const html = await native(protectMathExpressions(markdown))
          const withMath = renderMathExpressions(html, output)
          return highlightCodeBlocks(withMath)
        },
        async parseNoMath(markdown: string): Promise<string> {
          const html = await native(protectMathExpressions(markdown))
          return highlightCodeBlocks(html)
        },
        async parseFast(markdown: string): Promise<string> {
          // Keep the first paint in-process; native IPC is too expensive per message.
          return fastParser.parse(protectMathExpressions(markdown))
        },
        async parseLite(markdown: string): Promise<string> {
          // Large previews still mount with the local lightweight parser, then upgrade later.
          return liteParser.parse(protectMathExpressions(markdown))
        },
        renderMath(html: string) {
          return renderMathExpressions(html, output)
        },
        async highlight(code: string, lang?: string) {
          return highlight(code, lang)
        },
      }
    }

    return {
      async parse(markdown: string): Promise<string> {
        const html = await fullParser.parse(protectMathExpressions(markdown))
        return renderMathExpressions(html, output)
      },
      async parseNoMath(markdown: string): Promise<string> {
        return noMathParser.parse(protectMathExpressions(markdown))
      },
      async parseFast(markdown: string): Promise<string> {
        return fastParser.parse(protectMathExpressions(markdown))
      },
      async parseLite(markdown: string): Promise<string> {
        // The lite path skips KaTeX/shiki so large file previews can mount before block-by-block upgrades run.
        return liteParser.parse(protectMathExpressions(markdown))
      },
      renderMath(html: string) {
        return renderMathExpressions(html, output)
      },
      async highlight(code: string, lang?: string) {
        return highlight(code, lang)
      },
    }
  },
})
