import { marked } from "marked"
import markedKatex from "marked-katex-extension"
import markedShiki from "marked-shiki"
// FORK: GitHub 风 callout(> [!NOTE] ...)+ 脚注 ([^1])2026-05-05
import markedAlert from "marked-alert"
import markedFootnote from "marked-footnote"
import katex from "katex"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { createSimpleContext } from "./helper"
import { getSharedHighlighter, registerCustomTheme, ThemeRegistrationResolved } from "@pierre/diffs"

// FORK: 2026-05-08 — GFM 风 heading slug:小写 + 去标点 + 空格转连字符 + 保留中文
// 与 GitHub 的 anchor 生成规则尽量对齐,让 markdown-test.md 的目录链接 [...](#1-标题层级) 能跳转
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}一-龥\s-]/gu, "") // 保 alphanumeric + 中文 + 空格 + 连字符
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// FORK: 2026-05-08 — GFM emoji shortcode 表(常见 ~80 个)
// 不在表内的 :xxx: 保持原文(避免误吞 CSS :hover/::before 类语法)
const EMOJI_SHORTCODES: Record<string, string> = {
  // 测试文档常用
  rocket: "🚀", tada: "🎉", sparkles: "✨", white_check_mark: "✅",
  warning: "⚠️", bug: "🐛", book: "📖", art: "🎨",
  // 表情
  smile: "😄", grin: "😁", joy: "😂", laughing: "😆", wink: "😉",
  blush: "😊", heart_eyes: "😍", thinking: "🤔", cry: "😢", angry: "😠",
  // 手势
  thumbsup: "👍", "+1": "👍", thumbsdown: "👎", "-1": "👎",
  ok_hand: "👌", clap: "👏", pray: "🙏", muscle: "💪", wave: "👋",
  // 符号
  heart: "❤️", broken_heart: "💔", star: "⭐", star2: "🌟",
  fire: "🔥", boom: "💥", zap: "⚡", bulb: "💡",
  // 标记 / 状态
  x: "❌", o: "⭕", heavy_check_mark: "✔️", heavy_multiplication_x: "✖️",
  question: "❓", exclamation: "❗", grey_question: "❔", grey_exclamation: "❕",
  no_entry: "⛔", no_entry_sign: "🚫", recycle: "♻️",
  // 物品
  computer: "💻", phone: "📱", iphone: "📱", email: "📧", mailbox: "📫",
  package: "📦", file_folder: "📁", open_file_folder: "📂", page_facing_up: "📄",
  pencil: "📝", memo: "📝", paperclip: "📎", chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉", bar_chart: "📊", date: "📅",
  // 自然
  sun: "☀️", cloud: "☁️", umbrella: "☂️", snowflake: "❄️",
  rainbow: "🌈", ocean: "🌊", mountain: "⛰️",
  // 动物
  dog: "🐶", cat: "🐱", mouse: "🐭", panda_face: "🐼", lion: "🦁",
  // 食物
  coffee: "☕", tea: "🍵", beer: "🍺", pizza: "🍕", hamburger: "🍔",
  apple: "🍎", lemon: "🍋", strawberry: "🍓", watermelon: "🍉",
  // 交通
  car: "🚗", taxi: "🚕", bus: "🚌", airplane: "✈️", ship: "🚢",
  rocket_alt: "🚀",
  // 时间
  clock: "🕐", hourglass: "⌛", alarm_clock: "⏰",
  // 杂项
  gift: "🎁", trophy: "🏆", medal: "🏅", crown: "👑",
  earth_americas: "🌎", earth_asia: "🌏", earth_africa: "🌍",
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

  const highlighter = await getSharedHighlighter({
    themes: ["OpenCode"],
    langs: [],
    preferredHighlighter: "shiki-wasm",
  })

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
          link(token) {
            const titleAttr = token.title ? ` title="${token.title}"` : ""
            // FORK: 2026-05-08 — 用 parseInline(tokens) 而非 raw text,让嵌套 ![]() 能正确渲染成 <img>
            const inner = token.tokens
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? (this as any).parser.parseInline(token.tokens)
              : token.text
            // 锚点链接(href 以 # 开头)走内部跳转,不加 target=_blank 等外链属性
            if (token.href.startsWith("#")) {
              return `<a href="${token.href}"${titleAttr}>${inner}</a>`
            }
            return `<a href="${token.href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${inner}</a>`
          },
          heading(token) {
            // FORK: 2026-05-08 — 给 heading 自动生成 GFM-style anchor id(支持中文),让 [text](#anchor) 目录跳转生效
            const level = token.depth
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const text = (this as any).parser.parseInline(token.tokens)
            const id = slugifyHeading(token.text || "")
            return `<h${level} id="${id}">${text}</h${level}>\n`
          },
        },
      },
      // FORK: GitHub 风 callout — > [!NOTE] / > [!TIP] / > [!IMPORTANT] / > [!WARNING] / > [!CAUTION] 2026-05-05
      markedAlert(),
      // FORK: 脚注 [^1] + [^1]: 解释 — 学术 / 技术文档高频 2026-05-05
      markedFootnote(),
      // FORK: ==高亮文本== → <mark>高亮文本</mark> 2026-05-08
      // GFM 不支持 ==,需自定义 inline extension(marked-mark 等包不维护,inline 写更稳)
      // 顺带 :emoji: shortcode 也走同一 use 调用
      {
        extensions: [
          {
            name: "mark",
            level: "inline",
            start(src: string) {
              return src.match(/==[^=\n]/)?.index
            },
            tokenizer(src: string) {
              const m = /^==([^=\n]+)==/.exec(src)
              if (!m) return undefined
              return { type: "mark", raw: m[0], text: m[1] }
            },
            renderer(token: any) {
              return `<mark>${token.text}</mark>`
            },
          } as any,
          // FORK: 2026-05-08 :rocket: 类 GFM emoji shortcode → Unicode emoji
          // 内置常用 ~80 个;不在表里的 :xxx: 保持原文(避免误吞 ::pseudo / :hover: 等 CSS 语法)
          {
            name: "emojiShortcode",
            level: "inline",
            start(src: string) {
              return src.match(/:[a-z_+0-9-]+:/)?.index
            },
            tokenizer(src: string) {
              const m = /^:([a-z_+0-9-]+):/.exec(src)
              if (!m) return undefined
              if (!(m[1] in EMOJI_SHORTCODES)) return undefined
              return { type: "emojiShortcode", raw: m[0], name: m[1] }
            },
            renderer(token: any) {
              return EMOJI_SHORTCODES[token.name] ?? `:${token.name}:`
            },
          } as any,
        ],
      },
      markedKatex({
        throwOnError: false,
        nonStandard: true,
      }),
      markedShiki({
        async highlight(code, lang) {
          // FORK: ```mermaid 代码块拦截 — 在 shiki 处理前返回 placeholder,
          // 让 markdown.tsx 异步渲染为 SVG;不走 shiki 高亮 2026-05-05
          if (lang === "mermaid") {
            const escaped = code
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
            return `<div data-component="markdown-mermaid" data-mermaid-pending="">${escaped}</div>`
          }
          const highlighter = await getSharedHighlighter({
            themes: ["OpenCode"],
            langs: [],
            preferredHighlighter: "shiki-wasm",
          })
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
