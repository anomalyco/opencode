import {
  CodeRenderable,
  TextBuffer,
  type ChunkRenderContext,
  type OnChunksCallback,
  type OptimizedBuffer,
  type RenderNodeContext,
  type TextChunk,
} from "@opentui/core"
import { hasRtl, layoutBidiText, widthOffsetToBoundary, wrappedLogicalText, type BidiLayout } from "../util/bidi"

// Markdown renderNode hook that installs bidi-aware painting on the text
// blocks (paragraph/heading) of a <markdown> element. Fenced code blocks,
// tables, diffs and every other block keep the stock LTR renderer, which is
// the required behavior for code.
//
// OpenTUI 0.4.5 offers renderNode as the only per-block override that
// preserves in-place streaming updates, so the hook patches the default
// renderable instance: it shadows renderSelf (the paint entrypoint) and
// wraps the onChunks callback to capture the tree-sitter styled chunks.
// Nothing else about the renderable changes: measurement, selection, copy
// and streaming reconciliation continue through the native text buffer,
// which is kept in sync with the wrapped logical text.

type StyledSource = {
  text: string
  chunks: TextChunk[]
  // Char offset where each chunk starts within text.
  offsets: number[]
}

type BidiCodeState = {
  styled: StyledSource | undefined
  layout: BidiLayout | undefined
  // Logical source text of the current layout (pre-wrap).
  source: string
  wrapped: string | undefined
  width: number
  // Bumped on every captured chunk update so style-only changes (same text,
  // new styles) still rebuild the layout instead of painting a stale one.
  styledVersion: number
  paintedVersion: number
}

const patched = new WeakSet<CodeRenderable>()

// Protected members of TextBufferRenderable needed for buffer sync, plus
// the highlight machinery. startHighlight/_highlightsDirty are private in
// the .d.ts but public at runtime; these shapes only widen the TypeScript
// view. Coupled to @opentui/core 0.4.5 (see script/upgrade-opentui.ts when
// bumping).
type CodeInternals = {
  textBuffer: TextBuffer
  plainText: string
  updateTextInfo(): void
  startHighlight(): void
  _highlightsDirty?: boolean
}

export function bidiMarkdownRenderNode(token: { type: string }, context: RenderNodeContext) {
  if (token.type !== "paragraph" && token.type !== "heading") return undefined
  const renderable = context.defaultRender()
  if (!(renderable instanceof CodeRenderable)) return renderable ?? undefined
  applyBidiCodePaint(renderable)
  return renderable
}

export function applyBidiCodePaint(renderable: CodeRenderable) {
  if (patched.has(renderable)) return
  patched.add(renderable)

  const state: BidiCodeState = {
    styled: undefined,
    layout: undefined,
    source: "",
    wrapped: undefined,
    width: 0,
    styledVersion: 0,
    paintedVersion: -1,
  }
  const internals = renderable as unknown as CodeInternals
  const self = renderable as unknown as { renderSelf(buffer: OptimizedBuffer): void }
  const originalRenderSelf = self.renderSelf.bind(renderable)

  const originalOnChunks: OnChunksCallback | undefined = renderable.onChunks
  renderable.onChunks = async (chunks: TextChunk[], context: ChunkRenderContext) => {
    const result = originalOnChunks ? await originalOnChunks(chunks, context) : undefined
    const captured = result ?? chunks
    let text = ""
    const offsets: number[] = []
    for (const chunk of captured) {
      offsets.push(text.length)
      text += chunk.text
    }
    state.styled = { text, chunks: captured, offsets }
    state.styledVersion++
    state.layout = undefined
    state.wrapped = undefined
    return result
  }

  self.renderSelf = (buffer: OptimizedBuffer) => {
    const content = renderable.content
    const plain = internals.plainText
    // The buffer may hold our pre-wrapped text; recover the logical source.
    const current = state.wrapped !== undefined && plain === state.wrapped ? state.source : plain
    if (!hasRtl(content) || renderable.width <= 0) {
      if (state.wrapped !== undefined) {
        if (plain !== content) {
          internals.textBuffer.setText(content)
          internals.updateTextInfo()
        }
        state.wrapped = undefined
        state.layout = undefined
      }
      originalRenderSelf(buffer)
      return
    }

    if (
      state.source !== current ||
      state.width !== renderable.width ||
      state.paintedVersion !== state.styledVersion
    ) {
      state.source = current
      state.width = renderable.width
      state.paintedVersion = state.styledVersion
      state.layout = layoutBidiText(current, renderable.width)
      state.wrapped = wrappedLogicalText(state.layout)
    }

    // The patched paint replaces Code's renderSelf, which normally starts
    // tree-sitter highlighting when dirty. Mirror that kickoff exactly
    // (clear the flag synchronously, then start) so syntax colors keep
    // flowing for RTL blocks on content, theme, and conceal changes.
    if (internals._highlightsDirty) {
      internals._highlightsDirty = false
      internals.startHighlight()
    }

    if (plain !== state.wrapped) {
      internals.textBuffer.setText(state.wrapped ?? current)
      internals.updateTextInfo()
    }
    paintStyledLines(buffer, state, renderable)
  }
}

function paintStyledLines(buffer: OptimizedBuffer, state: BidiCodeState, renderable: CodeRenderable) {
  const layout = state.layout
  if (!layout) return
  // Styles apply only when the captured chunk text still matches the layout
  // source; otherwise the paint falls back to the renderable defaults (the
  // brief streaming window before tree-sitter styling lands).
  const styled = state.styled && state.styled.text === state.source ? state.styled : undefined
  const defaultFg = renderable.fg
  const defaultBg = renderable.bg
  const defaultAttributes = renderable.attributes
  const selection = renderable.getSelection()
  const selectionFg = renderable.selectionFg ?? defaultFg
  const selectionBg = renderable.selectionBg ?? defaultBg
  const selStart = selection ? widthOffsetToBoundary(layout, selection.start) : -1
  const selEnd = selection ? widthOffsetToBoundary(layout, selection.end) : -1
  const width = renderable.width
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]
    const y = renderable.screenY + i
    if (y < 0 || y >= buffer.height) continue
    const x0 = line.rtl ? renderable.screenX + width - line.width : renderable.screenX
    for (const cell of line.cells) {
      const x = x0 + cell.col
      if (x < 0 || x >= buffer.width) continue
      const chunk = styled ? chunkAt(styled, layout.glyphs[cell.glyph].charIndex) : undefined
      const selected = selStart >= 0 && cell.glyph >= selStart && cell.glyph < selEnd
      buffer.setCell(
        x,
        y,
        cell.char,
        selected ? selectionFg : (chunk?.fg ?? defaultFg),
        selected ? selectionBg : (chunk?.bg ?? defaultBg),
        chunk?.attributes ?? defaultAttributes,
      )
    }
  }
}

function chunkAt(source: StyledSource, charIndex: number) {
  let lo = 0
  let hi = source.offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (source.offsets[mid] <= charIndex) lo = mid
    else hi = mid - 1
  }
  const chunk = source.chunks[lo]
  return chunk && charIndex < source.offsets[lo] + chunk.text.length ? chunk : undefined
}
