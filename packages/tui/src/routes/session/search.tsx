import {
  TextAttributes,
  TextBufferRenderable,
  TextTableRenderable,
  resolveRenderLib,
  type InputRenderable,
  type LineInfo,
  type RGBA,
  type Renderable,
  type ScrollBoxRenderable,
  type SyntaxStyle,
  type TextBuffer,
  type WidthMethod,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"

// Renderables registered here (and everything below them) are searched.
export const searchable = new WeakSet<Renderable>()

// Highlight refs are u16 and priorities u8 in OpenTUI's native highlight struct.
const MATCH_REF = 0x5e01
const CURRENT_REF = 0x5e02
const MATCH_PRIORITY = 200
const CURRENT_PRIORITY = 210

export type SearchTarget = {
  text: string
  read: () => string
  buffer: TextBuffer
  top: () => number
  lines: () => LineInfo
  alive: () => boolean
  redraw: () => void
}

export type SearchMatch = {
  target: SearchTarget
  // Offsets in OpenTUI highlight units: display columns, newlines not counted.
  start: number
  end: number
  // Display column of the match start with newlines counted, as used by LineInfo.lineStartCols.
  column: number
  // Logical line of the match start, for TextBuffer.getLineHighlights.
  line: number
  highlighted?: boolean
}

export type SearchStyle = {
  match: { fg: RGBA; bg: RGBA }
  current: { fg: RGBA; bg: RGBA }
}

export function findMatches(root: Renderable, query: string, widthMethod: WidthMethod): SearchMatch[] {
  if (!query) return []
  const pattern = new RegExp(escapeRegExp(query), /\p{Lu}/u.test(query) ? "gu" : "giu")
  return collectTargets(root, false).flatMap((target) => {
    const hits = [...target.text.matchAll(pattern)]
    if (hits.length === 0) return []
    const columns = measureColumns(target.text, widthMethod)
    return hits.map((hit) => ({
      target,
      start: columns.highlight[hit.index],
      end: columns.highlight[hit.index + hit[0].length],
      column: columns.line[hit.index],
      line: columns.line[hit.index] - columns.highlight[hit.index],
    }))
  })
}

// OpenTUI rebuilds text buffers when markdown first renders or restyles a block, dropping
// highlights and sometimes changing the text, so visible matches need checking while searching.
export function staleMatches(matches: SearchMatch[], top: number, bottom: number) {
  return matches.some((match) => {
    if (!match.highlighted) return false
    if (!match.target.alive()) return true
    const row = matchRow(match)
    if (row < top || row >= bottom) return false
    if (match.target.read() !== match.target.text) return true
    return !match.target.buffer.getLineHighlights(match.line).some((item) => item.hlRef === MATCH_REF)
  })
}

// Screen row of a match, from the live layout so it stays right after resizes and scrolling.
export function matchRow(match: SearchMatch) {
  const starts = match.target.lines().lineStartCols
  const line = starts.findLastIndex((start) => start <= match.column)
  return match.target.top() + Math.max(line, 0)
}

export function highlightMatches(matches: SearchMatch[], current: number, style: SearchStyle) {
  matches.forEach((match, index) => {
    const ids = styleIds(match.target.buffer, style)
    if (!ids) return
    match.target.buffer.addHighlightByCharRange({
      start: match.start,
      end: match.end,
      styleId: ids.match,
      priority: MATCH_PRIORITY,
      hlRef: MATCH_REF,
    })
    match.highlighted = true
    if (index === current) addCurrent(match, ids.current)
  })
  new Set(matches.map((match) => match.target)).forEach((target) => target.redraw())
}

export function moveCurrent(matches: SearchMatch[], previous: number, next: number, style: SearchStyle) {
  const before = matches[previous]
  if (before?.target.alive()) {
    before.target.buffer.removeHighlightsByRef(CURRENT_REF)
    before.target.redraw()
  }
  const after = matches[next]
  if (!after?.target.alive()) return
  const ids = styleIds(after.target.buffer, style)
  if (!ids) return
  addCurrent(after, ids.current)
  after.target.redraw()
}

export function clearHighlights(matches: SearchMatch[]) {
  new Set(matches.map((match) => match.target)).forEach((target) => {
    if (!target.alive()) return
    target.buffer.removeHighlightsByRef(MATCH_REF)
    target.buffer.removeHighlightsByRef(CURRENT_REF)
    target.redraw()
  })
}

export function createSessionSearch(input: { scroll: () => ScrollBoxRenderable | undefined; content: () => unknown }) {
  const renderer = useRenderer()
  const { theme } = useTheme()
  const [active, setActive] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [matches, setMatches] = createSignal<SearchMatch[]>([])
  const [current, setCurrent] = createSignal(-1)
  const style = createMemo(() => ({
    match: { fg: theme.background, bg: theme.warning },
    current: { fg: theme.background, bg: theme.primary },
  }))
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function rescan(anchor: "viewport" | "current") {
    const scroll = input.scroll()
    if (!scroll || scroll.isDestroyed) return
    const previous = matches()[current()]
    const previousRow = previous?.target.alive() ? matchRow(previous) : undefined
    clearHighlights(matches())
    const found = findMatches(scroll.content, query(), renderer.widthMethod)
    const index = pickCurrent(found, anchor === "current" ? previousRow : undefined, scroll)
    highlightMatches(found, index, style())
    batch(() => {
      setMatches(found)
      setCurrent(index)
    })
    if (anchor === "viewport" && found[index]) reveal(found[index], scroll)
  }

  function step(direction: 1 | -1) {
    const found = matches()
    const scroll = input.scroll()
    if (found.length === 0 || !scroll) return
    const next = (current() + direction + found.length) % found.length
    moveCurrent(found, current(), next, style())
    setCurrent(next)
    reveal(found[next], scroll)
  }

  function close() {
    timers.forEach(clearTimeout)
    timers.clear()
    clearHighlights(matches())
    batch(() => {
      setActive(false)
      setQuery("")
      setMatches([])
      setCurrent(-1)
    })
  }

  // Streaming text and async markdown concealment both rebuild text buffers, which drops highlights.
  createEffect(
    on(
      () => (active() && query() ? input.content() : undefined),
      (content) => {
        if (content === undefined) return
        timers.forEach(clearTimeout)
        timers.clear()
        ;[60, 400].forEach((delay) => {
          const timer = setTimeout(() => {
            timers.delete(timer)
            rescan("current")
          }, delay)
          timers.add(timer)
        })
      },
      { defer: true },
    ),
  )

  createEffect(on(style, () => active() && query() && rescan("current"), { defer: true }))

  createEffect(() => {
    if (!active() || !query()) return
    const interval = setInterval(() => {
      const scroll = input.scroll()
      if (!scroll || scroll.isDestroyed) return
      const viewport = scroll.viewport
      if (staleMatches(matches(), viewport.y, viewport.y + viewport.height)) rescan("current")
    }, 150)
    onCleanup(() => clearInterval(interval))
  })

  onCleanup(close)

  return {
    active,
    query,
    total: () => matches().length,
    current: () => current(),
    open: () => setActive(true),
    close,
    search(value: string) {
      setQuery(value)
      rescan("viewport")
    },
    next: () => step(1),
    previous: () => step(-1),
  }
}

export type SessionSearch = ReturnType<typeof createSessionSearch>

export function SessionSearchBar(props: { search: SessionSearch }) {
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  let input: InputRenderable | undefined

  useBindings(() => ({
    priority: 10,
    bindings: [
      { key: "escape", desc: "Close search", group: "Search", cmd: () => props.search.close() },
      { key: "return", desc: "Next match", group: "Search", cmd: () => props.search.next() },
      { key: "down", desc: "Next match", group: "Search", cmd: () => props.search.next() },
      { key: "shift+return", desc: "Previous match", group: "Search", cmd: () => props.search.previous() },
      { key: "up", desc: "Previous match", group: "Search", cmd: () => props.search.previous() },
    ],
  }))

  const status = createMemo(() => {
    if (!props.search.query()) return ""
    if (props.search.total() === 0) return "no matches"
    return `${props.search.current() + 1}/${props.search.total()}`
  })

  return (
    <box flexDirection="row" flexShrink={0} gap={1} paddingLeft={1} backgroundColor={theme.backgroundPanel}>
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        Find
      </text>
      <input
        ref={(r) => {
          input = r
          setTimeout(() => {
            if (!input || input.isDestroyed) return
            input.focus()
          }, 1)
        }}
        onInput={(value) => props.search.search(value)}
        placeholder="Search messages"
        placeholderColor={theme.textMuted}
        cursorColor={theme.primary}
        cursorStyle={tuiConfig.cursor}
        focusedBackgroundColor={theme.backgroundPanel}
        focusedTextColor={theme.text}
        flexGrow={1}
      />
      <text fg={props.search.query() && props.search.total() === 0 ? theme.error : theme.text}>{status()}</text>
      <text fg={theme.textMuted} paddingRight={1}>
        enter/↓ next · shift+enter/↑ prev · esc close
      </text>
    </box>
  )
}

function collectTargets(node: Renderable, inside: boolean): SearchTarget[] {
  const within = inside || searchable.has(node)
  const own = within ? targetsOf(node) : []
  return [...own, ...node.getChildren().flatMap((child) => collectTargets(child as Renderable, within))]
}

function targetsOf(node: Renderable): SearchTarget[] {
  if (node instanceof TextBufferRenderable) {
    return [
      {
        text: node.plainText,
        read: () => node.plainText,
        buffer: (node as unknown as { textBuffer: TextBuffer }).textBuffer,
        top: () => node.y,
        lines: () => node.lineInfo,
        alive: () => !node.isDestroyed,
        redraw: () => node.requestRender(),
      },
    ]
  }
  if (node instanceof TextTableRenderable) return tableTargets(node)
  return []
}

// TextTableRenderable keeps one private text buffer per cell and draws them at
// rowOffsets[row] + 1 + cellPaddingY (see drawCellRange in @opentui/core).
type TableInternals = {
  _cells?: { textBuffer: TextBuffer; textBufferView: { lineInfo: LineInfo } }[][]
  _layout?: { rowOffsets: number[] }
  _cellPaddingY?: number
  invalidateRasterOnly?: () => void
}

function tableTargets(table: TextTableRenderable): SearchTarget[] {
  const internals = table as unknown as TableInternals
  if (!Array.isArray(internals._cells) || typeof internals.invalidateRasterOnly !== "function") return []
  return internals._cells.flatMap((row, rowIndex) =>
    row.map((cell) => ({
      text: cell.textBuffer.getPlainText(),
      read: () => cell.textBuffer.getPlainText(),
      buffer: cell.textBuffer,
      top: () => table.y + (internals._layout?.rowOffsets[rowIndex] ?? 0) + 1 + (internals._cellPaddingY ?? 0),
      lines: () => cell.textBufferView.lineInfo,
      alive: () => !table.isDestroyed && internals._cells?.[rowIndex]?.includes(cell) === true,
      redraw: () => {
        internals.invalidateRasterOnly?.()
        table.requestRender()
      },
    })),
  )
}

function measureColumns(text: string, widthMethod: WidthMethod) {
  const highlight = new Int32Array(text.length + 1)
  const line = new Int32Array(text.length + 1)
  if (/^[\x20-\x7e\n]*$/.test(text)) {
    let newlines = 0
    for (let index = 0; index <= text.length; index++) {
      highlight[index] = index - newlines
      line[index] = index
      if (text[index] === "\n") newlines++
    }
    return { highlight, line }
  }
  const graphemes = [...segmenter.segment(text)]
  const widths = nativeWidths(text, widthMethod, graphemes)
  let width = 0
  let newlines = 0
  let cell = 0
  for (const grapheme of graphemes) {
    highlight.fill(width, grapheme.index, grapheme.index + grapheme.segment.length)
    line.fill(width + newlines, grapheme.index, grapheme.index + grapheme.segment.length)
    if (grapheme.segment === "\n") {
      newlines++
      continue
    }
    width += widths[cell++] ?? 1
  }
  highlight[text.length] = width
  line[text.length] = width + newlines
  return { highlight, line }
}

const segmenter = new Intl.Segmenter()

// The native encoder skips newlines; fall back to Bun's width if its segmentation disagrees with ours.
function nativeWidths(text: string, widthMethod: WidthMethod, graphemes: Intl.SegmentData[]) {
  const cells = graphemes.filter((grapheme) => grapheme.segment !== "\n")
  const lib = resolveRenderLib()
  const encoded = lib.encodeUnicode(text, widthMethod)
  if (!encoded) return cells.map((grapheme) => Bun.stringWidth(grapheme.segment))
  const widths = encoded.data.map((item) => item.width)
  lib.freeUnicode(encoded)
  if (widths.length === cells.length) return widths
  return cells.map((grapheme) => Bun.stringWidth(grapheme.segment))
}

const registered = new WeakMap<SyntaxStyle, { style: SearchStyle; match: number; current: number }>()

function styleIds(buffer: TextBuffer, style: SearchStyle) {
  const syntax = buffer.getSyntaxStyle()
  if (!syntax) return
  const cached = registered.get(syntax)
  if (cached?.style === style) return cached
  const ids = {
    style,
    match: syntax.registerStyle("search.match", style.match),
    current: syntax.registerStyle("search.current", { ...style.current, bold: true }),
  }
  registered.set(syntax, ids)
  return ids
}

function addCurrent(match: SearchMatch, styleId: number) {
  match.target.buffer.addHighlightByCharRange({
    start: match.start,
    end: match.end,
    styleId,
    priority: CURRENT_PRIORITY,
    hlRef: CURRENT_REF,
  })
}

function pickCurrent(matches: SearchMatch[], previousRow: number | undefined, scroll: ScrollBoxRenderable) {
  if (matches.length === 0) return -1
  const rows = matches.map(matchRow)
  if (previousRow !== undefined) {
    return rows.reduce((best, row, index) => (Math.abs(row - previousRow) < Math.abs(rows[best] - previousRow) ? index : best), 0)
  }
  const index = rows.findIndex((row) => row >= scroll.viewport.y)
  return index === -1 ? 0 : index
}

function reveal(match: SearchMatch, scroll: ScrollBoxRenderable) {
  const row = matchRow(match)
  const viewport = scroll.viewport
  if (row >= viewport.y + 1 && row < viewport.y + viewport.height - 1) return
  scroll.scrollBy(row - (viewport.y + Math.floor(viewport.height / 2)))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
