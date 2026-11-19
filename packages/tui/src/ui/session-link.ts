import {
  CodeRenderable,
  TextAttributes,
  detectLinks,
  type ChunkRenderContext,
  type CliRenderer,
  type MarkdownRenderable,
  type MouseEvent,
  type Renderable,
  type TextChunk,
} from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, untrack } from "solid-js"
import { parseSessionMention, sessionMentions } from "@opencode/util/session-mention"
import { displayLabel } from "@opencode/util/session-title-fallback"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { stringWidth } from "../util/string-width"
import { useDialog } from "./dialog"
import { plainClick } from "./link"

// `sessionIDs` holds every ID the block mentions, linked or not, so a label change re-highlights only
// the blocks that show it.
type Rendered = {
  text: string
  ranges: { start: number; end: number; sessionID: string }[]
  sessionIDs: Set<string>
}

/**
 * Returns a `<markdown>` ref that shows session IDs as links titled after their sessions and
 * opens them on click, like the web app. The current session, archived sessions and sessions
 * that cannot be loaded stay plain IDs. Links re-render when a label changes.
 */
export function useSessionLinks() {
  const data = useData()
  const route = useRoute()
  const dialog = useDialog()
  const renderer = useRenderer()
  const labelOf = (sessionID: string) => {
    if (route.data.type === "session" && route.data.sessionID === sessionID) return
    const session = data.session.get(sessionID)
    // Sync dedupes in-flight and finished loads; a miss marks the session missing.
    if (!session && !data.session.missing(sessionID))
      untrack(() => void data.session.sync(sessionID).catch(() => undefined))
    return session && session.time.archived === undefined ? displayLabel(session) : undefined
  }
  // Labels each ID was last rendered with, so the effect below re-renders only on a change.
  const used = new Map<string, string | undefined>()
  const [version, setVersion] = createSignal(0)
  const rendered = new WeakMap<CodeRenderable, Rendered>()
  let markdown: MarkdownRenderable | undefined

  // OpenTUI calls this as a method of each prose block, so `this` is the block. Fenced code never gets it.
  function linkChunks(this: CodeRenderable, chunks: TextChunk[], context: ChunkRenderContext) {
    const style = context.syntaxStyle.mergeStyles("markup.link.url")
    // Like the web app, a code span links only when it is exactly a session ID, so a command such
    // as `opencode --session ses_…` stays copyable. Marked by displayed offset, since detectLinks
    // can split chunks.
    const raw = context.highlights.filter(([, , group]) => group === "markup.raw" || group.startsWith("markup.raw."))
    let position = 0
    const code = chunks.flatMap((chunk, index) => {
      const start = position
      position += chunk.text.length
      const source = context.sourceRanges?.[index]
      const span = source && raw.find(([from, to]) => from <= source.start && source.end <= to)
      const text = span && context.content.slice(span[0], span[1]).replace(/^`+\s?|\s?`+$/g, "")
      return text !== undefined && !parseSessionMention(text) ? [{ start, end: position }] : []
    })
    position = 0
    const sessionIDs = new Set<string>()
    const parts = detectLinks(chunks, context).flatMap((chunk): { chunk: TextChunk; sessionID?: string }[] => {
      const start = position
      position += chunk.text.length
      const plain = chunk.link || code.some((range) => range.start <= start && start < range.end)
      const mentions = plain ? [] : sessionMentions(chunk.text)
      if (mentions.length === 0) return [{ chunk }]
      // Odd parts are the mentions.
      const cuts = [0, ...mentions.flatMap((mention) => [mention.start, mention.end]), chunk.text.length]
      return cuts.slice(1).flatMap((end, index) => {
        const text = chunk.text.slice(cuts[index], end)
        const mention = index % 2 ? mentions[(index - 1) / 2]! : undefined
        const label = mention && labelOf(mention.id)
        if (mention) sessionIDs.add(mention.id)
        if (mention && (!used.has(mention.id) || used.get(mention.id) !== label)) {
          used.set(mention.id, label)
          setVersion((value) => value + 1)
        }
        if (!mention || label === undefined) return text ? [{ chunk: { ...chunk, text } }] : []
        const link = {
          ...chunk,
          // Raw markdown mode shows the source.
          text: this.conceal ? `@${label}` : text,
          fg: style.fg ?? chunk.fg,
          attributes: style.attributes | TextAttributes.UNDERLINE,
        }
        return [{ chunk: link, sessionID: mention.id }]
      })
    })
    let offset = 0
    const ranges = parts.flatMap((part) => {
      const start = offset
      offset += part.chunk.text.length
      return part.sessionID ? [{ start, end: offset, sessionID: part.sessionID }] : []
    })
    rendered.set(this, { text: parts.map((part) => part.chunk.text).join(""), ranges, sessionIDs })
    return parts.map((part) => part.chunk)
  }

  createEffect(() => {
    version()
    const changed = [...used].flatMap(([sessionID, label]) => (labelOf(sessionID) === label ? [] : [sessionID]))
    if (!markdown || changed.length === 0) return
    changed.forEach((sessionID) => used.set(sessionID, labelOf(sessionID)))
    // Toggling the callback marks the block's highlight dirty while keeping the identity OpenTUI
    // checks when terminal capabilities refresh link styling. Dirty blocks highlight on the next
    // frame, so labels that change within one frame share a single re-highlight.
    const refresh = (renderable: Renderable): void => {
      if (
        renderable instanceof CodeRenderable &&
        renderable.onChunks === linkChunks &&
        changed.some((sessionID) => rendered.get(renderable)?.sessionIDs.has(sessionID))
      ) {
        renderable.onChunks = undefined
        renderable.onChunks = linkChunks
        renderable.requestRender()
      }
      renderable.getChildren().forEach(refresh)
    }
    untrack(() => refresh(markdown!))
  })

  // Solid calls refs before setting content, so every block Markdown creates picks up `linkChunks`.
  return (renderable: MarkdownRenderable) => {
    markdown = renderable
    // oxlint-disable-next-line no-restricted-globals -- OpenTUI has no public option for the markdown chunk callback.
    Reflect.set(renderable, "_linkifyMarkdownChunks", linkChunks)
    renderable.onMouseUp = (event) => {
      const sessionID = clickedSession(renderer, event, rendered)
      if (!sessionID) return
      event.stopPropagation()
      if (dialog.stack.length > 0) dialog.clear()
      route.navigate({ type: "session", sessionID })
    }
  }
}

function clickedSession(renderer: CliRenderer, event: MouseEvent, rendered: WeakMap<CodeRenderable, Rendered>) {
  const target = event.target
  if (!plainClick(renderer, event) || !(target instanceof CodeRenderable)) return
  const entry = rendered.get(target)
  // The streaming preview can briefly replace the highlighted text the ranges describe.
  if (!entry || entry.text !== target.plainText) return
  // Concealed markdown markers are absent from plainText, so map the cell through the wrapped
  // layout: rows report display columns, and a logical line starts on its row with wrap index 0.
  const info = target.lineInfo
  const row = event.y - target.y
  const line = info.lineSources[row]
  if (line === undefined) return
  const column = info.lineStartCols[row]! - info.lineStartCols[row - info.lineWraps[row]!]! + event.x - target.x
  const lines = entry.text.split("\n")
  const lineStart = lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0)
  const lineEnd = lineStart + lines[line]!.length
  return entry.ranges.find((range) => {
    if (range.start < lineStart || range.end > lineEnd) return false
    const start = stringWidth(entry.text.slice(lineStart, range.start))
    return column >= start && column < start + stringWidth(entry.text.slice(range.start, range.end))
  })?.sessionID
}
