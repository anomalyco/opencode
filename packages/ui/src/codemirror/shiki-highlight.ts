import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { RangeSetBuilder, type Extension } from "@codemirror/state"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { getSharedHighlighter } from "@pierre/diffs"
import type { CodeEditorLanguage } from "../components/code-editor"

export type ShikiHighlighter = Awaited<ReturnType<typeof getSharedHighlighter>>

export function editorLanguageToShikiLang(
  language: CodeEditorLanguage | undefined,
  path: string | undefined,
): BundledLanguage | undefined {
  if (language) {
    switch (language) {
      case "typescript":
        return "tsx"
      case "go":
        return "go"
      case "python":
        return "python"
      case "plaintext":
        return undefined
    }
  }
  if (path) {
    const lower = path.toLowerCase()
    const ext = lower.slice(lower.lastIndexOf("."))
    switch (ext) {
      case ".ts":
        return "typescript"
      case ".tsx":
        return "tsx"
      case ".js":
      case ".mjs":
      case ".cjs":
        return "javascript"
      case ".jsx":
        return "jsx"
      case ".go":
        return "go"
      case ".py":
      case ".pyi":
        return "python"
    }
  }
  return undefined
}

export async function loadShikiForLang(lang: BundledLanguage): Promise<ShikiHighlighter | undefined> {
  if (!(lang in bundledLanguages)) return undefined
  const highlighter = await getSharedHighlighter({
    themes: ["OpenCode"],
    langs: [],
    preferredHighlighter: "shiki-wasm",
  })
  if (!highlighter.getLoadedLanguages().includes(lang)) {
    await highlighter.loadLanguage(lang)
  }
  return highlighter
}

type TokensByLine = ReturnType<ShikiHighlighter["codeToTokens"]>["tokens"]

const MAX_FULLDOC_LINES = 5000

function makeMarkFactory() {
  const cache = new Map<string, Decoration>()
  return (color: string, fontStyle: number): Decoration => {
    const key = color + ":" + fontStyle
    let deco = cache.get(key)
    if (!deco) {
      let style = `color: ${color};`
      if (fontStyle & 1) style += " font-style: italic;"
      if (fontStyle & 2) style += " font-weight: bold;"
      if (fontStyle & 4) style += " text-decoration: underline;"
      deco = Decoration.mark({ attributes: { style } })
      cache.set(key, deco)
    }
    return deco
  }
}

function tokenizeDocument(
  doc: string,
  highlighter: ShikiHighlighter,
  lang: BundledLanguage,
): TokensByLine | undefined {
  try {
    return highlighter.codeToTokens(doc, { lang, theme: "OpenCode" }).tokens
  } catch {
    return undefined
  }
}

function buildFromTokens(view: EditorView, tokensByLine: TokensByLine): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const markFor = makeMarkFactory()
  for (const { from, to } of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(from).number
    const endLine = view.state.doc.lineAt(to).number
    for (let ln = startLine; ln <= endLine; ln++) {
      const line = view.state.doc.line(ln)
      const row = tokensByLine[ln - 1]
      if (!row) continue
      // Whole-doc tokenization gives ABSOLUTE token.offset, so walk by content
      // length from line start instead of using token.offset.
      let pos = line.from
      for (const token of row) {
        const len = token.content.length
        if (len <= 0) continue
        if (token.color) builder.add(pos, pos + len, markFor(token.color, token.fontStyle ?? 0))
        pos += len
      }
    }
  }
  return builder.finish()
}

function buildPerLine(view: EditorView, highlighter: ShikiHighlighter, lang: BundledLanguage): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const markFor = makeMarkFactory()
  for (const { from, to } of view.visibleRanges) {
    const startLine = view.state.doc.lineAt(from).number
    const endLine = view.state.doc.lineAt(to).number
    for (let ln = startLine; ln <= endLine; ln++) {
      const line = view.state.doc.line(ln)
      if (line.length === 0) continue
      let row
      try {
        row = highlighter.codeToTokens(line.text, { lang, theme: "OpenCode" }).tokens[0]
      } catch {
        continue
      }
      if (!row) continue
      for (const token of row) {
        const start = line.from + token.offset
        const end = start + token.content.length
        if (end <= start || !token.color) continue
        builder.add(start, end, markFor(token.color, token.fontStyle ?? 0))
      }
    }
  }
  return builder.finish()
}

export function shikiHighlightExtension(highlighter: ShikiHighlighter, lang: BundledLanguage): Extension {
  return ViewPlugin.fromClass(
    class {
      tokens: TokensByLine | undefined
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.tokens = this.tokenize(view)
        this.decorations = this.build(view)
      }
      tokenize(view: EditorView): TokensByLine | undefined {
        if (view.state.doc.lines > MAX_FULLDOC_LINES) return undefined
        return tokenizeDocument(view.state.doc.toString(), highlighter, lang)
      }
      build(view: EditorView): DecorationSet {
        return this.tokens ? buildFromTokens(view, this.tokens) : buildPerLine(view, highlighter, lang)
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.tokens = this.tokenize(update.view)
        if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view)
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  )
}

export function highlightMarkdownCodeBlocks(container: HTMLElement): void {
  const blocks = Array.from(container.querySelectorAll("pre > code")) as HTMLElement[]
  if (blocks.length === 0) return
  for (const code of blocks) {
    const cls = Array.from(code.classList).find((c) => c.startsWith("language-"))
    const langId = cls ? cls.slice("language-".length) : ""
    if (!langId || !(langId in bundledLanguages)) continue
    const text = code.textContent ?? ""
    if (!text.trim()) continue
    void loadShikiForLang(langId as BundledLanguage)
      .then((highlighter) => {
        if (!highlighter) return
        if (!container.isConnected) return
        const pre = code.parentElement
        if (!pre || !pre.isConnected) return
        const html = highlighter.codeToHtml(text, { lang: langId, theme: "OpenCode", tabindex: false })
        const tmp = document.createElement("div")
        tmp.innerHTML = html
        const next = tmp.firstElementChild
        if (next) pre.replaceWith(next)
      })
      .catch(() => {})
  }
}
