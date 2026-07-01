import type { Extension } from "@codemirror/state"
import { EditorView, ViewPlugin, hoverTooltip, keymap, type ViewUpdate } from "@codemirror/view"
import type { Text } from "@codemirror/state"
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { setDiagnostics, type Diagnostic as CMDiagnostic } from "@codemirror/lint"
import { Marked } from "marked"
import { highlightMarkdownCodeBlocks } from "../codemirror/shiki-highlight"

// Isolated marked instance: the global singleton has async extensions that make
// synchronous `parse(..., { async: false })` throw.
const hoverMarked = new Marked({ gfm: true, breaks: true })
// `external-link` anchors so the desktop renderer opens links in the OS browser
// instead of navigating (and tearing down) the app window.
hoverMarked.use({
  renderer: {
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const titleAttr = title ? ` title="${title}"` : ""
      return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

/** LSP-style 0-based position in UTF-16 code units. */
export type LspPosition = { line: number; character: number }

export type LspRange = { start: LspPosition; end: LspPosition }

export type LspDiagnostic = {
  range: LspRange
  severity?: number | string
  message: string
  source?: string
  code?: string | number
}

export interface LspClient {
  buffer(input: { path: string; text: string; version: number }): Promise<unknown>
  bufferClose(input: { path: string }): Promise<unknown>
  completion(input: {
    path: string
    line: number
    character: number
    triggerKind?: number
    triggerCharacter?: string
  }): Promise<unknown>
  hover(input: { path: string; line: number; character: number }): Promise<unknown>
  definition(input: { path: string; line: number; character: number }): Promise<unknown>
  diagnostics(input: { path: string }): Promise<unknown>
}

export type LspExtensionsOptions = {
  path: string
  bumpVersion: () => number
  lsp: LspClient
  onOpenLocation: (path: string, pos: LspPosition) => void
  subscribeDiagnostics: (path: string, cb: (list: LspDiagnostic[]) => void) => () => void
  debounceMs?: number
}

// LSP positions are 0-based {line, character} in UTF-16 code units; CM lines are
// 1-based. JS strings are UTF-16, so a char index into line text is the unit count.
export function offsetToPos(doc: Text, offset: number): LspPosition {
  const clamped = Math.max(0, Math.min(offset, doc.length))
  const line = doc.lineAt(clamped)
  return { line: line.number - 1, character: clamped - line.from }
}

export function posToOffset(doc: Text, pos: LspPosition): number {
  const lineNumber = Math.max(1, Math.min(pos.line + 1, doc.lines))
  const line = doc.line(lineNumber)
  const character = Math.max(0, Math.min(pos.character, line.length))
  return line.from + character
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

export function severityToCM(severity: number | string | undefined): CMDiagnostic["severity"] {
  switch (toNumber(severity)) {
    case 1:
      return "error"
    case 2:
      return "warning"
    case 3:
      return "info"
    case 4:
      return "info"
    default:
      return "error"
  }
}

export function mapDiagnostics(doc: Text, list: LspDiagnostic[]): CMDiagnostic[] {
  const out: CMDiagnostic[] = []
  for (const d of list ?? []) {
    if (!d?.range) continue
    let from = posToOffset(doc, d.range.start)
    let to = posToOffset(doc, d.range.end)
    if (to < from) [from, to] = [to, from]
    out.push({
      from,
      to,
      severity: severityToCM(d.severity),
      message: d.message ?? "",
      ...(d.source ? { source: d.source } : {}),
    })
  }
  return out
}

const COMPLETION_KIND_LABELS: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "constructor",
  5: "variable",
  6: "variable",
  7: "class",
  8: "interface",
  9: "namespace",
  10: "property",
  11: "constant",
  12: "enum",
  13: "enum",
  14: "keyword",
  15: "text",
  21: "constant",
  22: "type",
  25: "type",
}

type RawCompletionItem = {
  label: string
  detail?: string
  insertText?: string
  kind?: number
  textEdit?: { newText?: string }
  sortText?: string
  documentation?: string | { value?: string; kind?: string }
}

export function documentationToText(doc: RawCompletionItem["documentation"]): string {
  if (doc == null) return ""
  if (typeof doc === "string") return doc
  return typeof doc.value === "string" ? doc.value : ""
}

function renderCompletionInfo(item: RawCompletionItem): Node | null {
  const docText = documentationToText(item.documentation)
  if (!docText && !item.detail) return null
  const dom = document.createElement("div")
  dom.className = "cm-completion-doc"
  if (item.detail) {
    const sig = document.createElement("div")
    sig.className = "cm-completion-doc-signature"
    sig.textContent = item.detail
    dom.appendChild(sig)
  }
  if (docText) {
    const body = document.createElement("div")
    body.className = "cm-completion-doc-body cm-lsp-hover"
    try {
      body.innerHTML = hoverMarked.parse(docText, { async: false }) as string
      highlightMarkdownCodeBlocks(body)
    } catch {
      body.textContent = docText
    }
    dom.appendChild(body)
  }
  return dom
}

function itemsFromCompletionEntry(entry: unknown): RawCompletionItem[] {
  if (!entry) return []
  if (Array.isArray(entry)) return entry as RawCompletionItem[]
  const items = (entry as { items?: unknown }).items
  if (Array.isArray(items)) return items as RawCompletionItem[]
  return []
}

// The LSP service returns one entry per attached client; each entry is a
// CompletionList or CompletionItem[]. A bare single result is also accepted.
export function normalizeCompletionItems(result: unknown): RawCompletionItem[] {
  if (!result) return []
  if (Array.isArray(result)) {
    // Distinguish the per-client array from a bare CompletionItem[] by whether
    // every entry has a string `label`.
    const arr = result as unknown[]
    const looksLikeItems = arr.every(
      (e) => e != null && typeof e === "object" && typeof (e as { label?: unknown }).label === "string",
    )
    if (looksLikeItems) return arr as RawCompletionItem[]
    return arr.flatMap((entry) => itemsFromCompletionEntry(entry))
  }
  return itemsFromCompletionEntry(result)
}

function mapCompletionItem(item: RawCompletionItem): Completion {
  const insert = item.insertText ?? item.textEdit?.newText ?? item.label
  const hasInfo = !!documentationToText(item.documentation) || !!item.detail
  return {
    label: item.label,
    apply: insert,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.kind && COMPLETION_KIND_LABELS[item.kind] ? { type: COMPLETION_KIND_LABELS[item.kind] } : {}),
    ...(hasInfo ? { info: () => renderCompletionInfo(item) } : {}),
  }
}

export function createCompletionSource(opts: Pick<LspExtensionsOptions, "path" | "lsp" | "bumpVersion">) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/[\w$]*/)
    const triggerCharacter = ctx.pos > 0 ? ctx.state.doc.sliceString(ctx.pos - 1, ctx.pos) : undefined
    const isWordTrigger = word && (word.from !== word.to || ctx.explicit)
    const isCharTrigger = triggerCharacter ? /[.\-:>@/]/.test(triggerCharacter) : false
    if (!ctx.explicit && !isWordTrigger && !isCharTrigger) return null

    const { line, character } = offsetToPos(ctx.state.doc, ctx.pos)

    // Flush the current document before requesting completion; the buffer-sync
    // plugin is debounced, so the server would otherwise answer on stale text.
    try {
      await opts.lsp.buffer({ path: opts.path, text: ctx.state.doc.toString(), version: opts.bumpVersion() })
    } catch {}

    let result: unknown
    try {
      result = await opts.lsp.completion({
        path: opts.path,
        line,
        character,
        triggerKind: ctx.explicit ? 1 : isCharTrigger ? 2 : 1,
        ...(isCharTrigger && triggerCharacter ? { triggerCharacter } : {}),
      })
    } catch {
      return null
    }
    if (ctx.aborted) return null

    const items = normalizeCompletionItems(result)
    if (items.length === 0) return null

    return {
      from: word ? word.from : ctx.pos,
      options: items.map(mapCompletionItem),
      validFor: /^[\w$]*$/,
    }
  }
}

type HoverContents = string | { value?: string; kind?: string } | Array<string | { value?: string }>

export function hoverContentsToText(contents: unknown): string {
  if (contents == null) return ""
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) {
    return contents.map((c) => hoverContentsToText(c)).filter(Boolean).join("\n\n")
  }
  const obj = contents as { value?: unknown }
  if (typeof obj.value === "string") return obj.value
  return ""
}

export function extractHoverContents(hover: unknown): HoverContents | undefined {
  if (!hover) return undefined
  const entries = Array.isArray(hover) ? hover : [hover]
  for (const entry of entries) {
    const contents = (entry as { contents?: HoverContents })?.contents
    if (contents != null && hoverContentsToText(contents)) return contents
  }
  return undefined
}

type RawLocation = {
  uri?: string
  targetUri?: string
  range?: LspRange
  targetSelectionRange?: LspRange
  targetRange?: LspRange
}

export function uriToPath(uri: string): string {
  if (!uri) return uri
  if (uri.startsWith("file://")) {
    const body = uri.slice("file://".length)
    try {
      return decodeURIComponent(body)
    } catch {
      return body
    }
  }
  return uri
}

function locationFromEntry(loc: RawLocation | undefined): { path: string; pos: LspPosition } | undefined {
  if (!loc) return undefined
  const uri = loc.uri ?? loc.targetUri
  const range = loc.range ?? loc.targetSelectionRange ?? loc.targetRange
  if (!uri || !range) return undefined
  return { path: uriToPath(uri), pos: range.start }
}

// Wire shape is Array<Location | Location[] | LocationLink[]> (one entry per
// client); flatten and return the first entry with a usable uri + range.
export function firstDefinition(result: unknown): { path: string; pos: LspPosition } | undefined {
  const top = Array.isArray(result) ? result : result ? [result] : []
  for (const entry of top) {
    const inner = Array.isArray(entry) ? entry : [entry]
    for (const loc of inner) {
      const found = locationFromEntry(loc as RawLocation | undefined)
      if (found) return found
    }
  }
  return undefined
}

function createBufferSyncPlugin(opts: LspExtensionsOptions) {
  const debounceMs = opts.debounceMs ?? 150

  return ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined

    const pushBuffer = () => {
      const text = view.state.doc.toString()
      void opts.lsp.buffer({ path: opts.path, text, version: opts.bumpVersion() }).catch(() => {})
    }

    const applyDiagnostics = (list: LspDiagnostic[]) => {
      view.dispatch(setDiagnostics(view.state, mapDiagnostics(view.state.doc, list)))
    }

    pushBuffer()
    void opts.lsp
      .diagnostics({ path: opts.path })
      .then((list) => applyDiagnostics((list as LspDiagnostic[]) ?? []))
      .catch(() => {})

    unsubscribe = opts.subscribeDiagnostics(opts.path, (list) => applyDiagnostics(list ?? []))

    return {
      update(update: ViewUpdate) {
        if (!update.docChanged) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = undefined
          pushBuffer()
        }, debounceMs)
      },
      destroy() {
        if (timer) clearTimeout(timer)
        // Unsubscribe before closing the buffer so no diagnostics arrive after close.
        unsubscribe?.()
        void opts.lsp.bufferClose({ path: opts.path }).catch(() => {})
      },
    }
  })
}

function normalizePathForCompare(p: string): string {
  return p.replace(/^\.?\//, "")
}

function goToDefinition(view: EditorView, pos: number, opts: LspExtensionsOptions) {
  const { line, character } = offsetToPos(view.state.doc, pos)
  void opts.lsp
    .definition({ path: opts.path, line, character })
    .then((result) => {
      const target = firstDefinition(result)
      if (!target) return
      if (normalizePathForCompare(target.path) === normalizePathForCompare(opts.path)) {
        const offset = posToOffset(view.state.doc, target.pos)
        view.dispatch({ selection: { anchor: offset }, scrollIntoView: true })
        view.focus()
        return
      }
      opts.onOpenLocation(target.path, target.pos)
    })
    .catch(() => {})
}

export function lspExtensions(opts: LspExtensionsOptions): Extension[] {
  const completionExt = autocompletion({
    override: [createCompletionSource(opts)],
    icons: true,
    tooltipClass: () => "cm-oc-autocomplete",
  })

  const hoverExt = hoverTooltip(async (view, pos) => {
    const { line, character } = offsetToPos(view.state.doc, pos)
    let hover: unknown
    try {
      hover = await opts.lsp.hover({ path: opts.path, line, character })
    } catch {
      return null
    }
    const contents = extractHoverContents(hover)
    const text = hoverContentsToText(contents)
    if (!text) return null
    return {
      pos,
      create: () => {
        const dom = document.createElement("div")
        dom.className = "cm-lsp-hover"
        try {
          dom.innerHTML = hoverMarked.parse(text, { async: false }) as string
          highlightMarkdownCodeBlocks(dom)
        } catch {
          dom.textContent = text
        }
        return { dom }
      },
    }
  })

  const definitionKeymap = keymap.of([
    {
      key: "F12",
      run: (view) => {
        goToDefinition(view, view.state.selection.main.head, opts)
        return true
      },
    },
  ])

  const modClick = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false
      event.preventDefault()
      goToDefinition(view, pos, opts)
      return true
    },
  })

  return [
    createBufferSyncPlugin(opts),
    completionExt,
    hoverExt,
    definitionKeymap,
    modClick,
  ]
}
