import { marked } from "marked"
import markedKatex from "marked-katex-extension"
import markedShiki from "marked-shiki"
import katex from "katex"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { getSharedHighlighter, registerCustomTheme, ThemeRegistrationResolved } from "@pierre/diffs"

registerCustomTheme("OpenCode", () => {
  return Promise.resolve({
    name: "OpenCode",
    colors: {
      "editor.background": "transparent",
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

function renderMathInText(text: string): string {
  let result = text

  // Display math: $$...$$
  const displayMathRegex = /\$\$([\s\S]*?)\$\$/g
  result = result.replace(displayMathRegex, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: true,
        throwOnError: false,
      })
    } catch {
      return `$$${math}$$`
    }
  })

  // Inline math: $...$
  const inlineMathRegex = /(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g
  result = result.replace(inlineMathRegex, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: false,
        throwOnError: false,
      })
    } catch {
      return `$${math}$`
    }
  })

  return result
}

function renderMathExpressions(html: string): string {
  // Split on code/pre/kbd tags to avoid processing their contents
  const codeBlockPattern = /(<(?:pre|code|kbd)[^>]*>[\s\S]*?<\/(?:pre|code|kbd)>)/gi
  const parts = html.split(codeBlockPattern)

  return parts
    .map((part, i) => {
      // Odd indices are the captured code blocks - leave them alone
      if (i % 2 === 1) return part
      // Process math only in non-code parts
      return renderMathInText(part)
    })
    .join("")
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g
  const matches = [...html.matchAll(codeBlockRegex)]
  if (matches.length === 0) return html

  const highlighter = await getSharedHighlighter({ themes: ["OpenCode"], langs: [] })

  let result = html
  for (const match of matches) {
    const [fullMatch, lang, escapedCode] = match
    const code = escapedCode
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

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
    result = result.replace(fullMatch, () => highlighted)
  }

  return result
}

export type NativeMarkdownParser = (markdown: string) => Promise<string>

export const { use: useMarked, provider: MarkedProvider } = createSimpleContext({
  name: "Marked",
  init: (props: { nativeParser?: NativeMarkdownParser }) => {
    const jsParser = marked.use(
      {
        renderer: {
          link({ href, title, text }) {
            const titleAttr = title ? ` title="${title}"` : ""
            return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
          },
        },
      },
      markedKatex({
        throwOnError: false,
      }),
      markedShiki({
        async highlight(code, lang) {
          const highlighter = await getSharedHighlighter({ themes: ["OpenCode"], langs: [] })
          if (!(lang in bundledLanguages)) {
            lang = "text"
          }
          if (!highlighter.getLoadedLanguages().includes(lang)) {
            await highlighter.loadLanguage(lang as BundledLanguage)
          }
          return highlighter.codeToHtml(code, {
            lang: lang || "text",
            theme: "OpenCode",
            tabindex: false,
          })
        },
      }),
    )

    if (props.nativeParser) {
      const nativeParser = props.nativeParser
      return {
        async parse(markdown: string): Promise<string> {
          const html = await nativeParser(markdown)
          const withMath = renderMathExpressions(html)
          return highlightCodeBlocks(withMath)
        },
      }
    }

    return jsParser
  },
})
