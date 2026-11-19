import {
  CodeRenderable,
  StyledText,
  TextRenderable,
  TextTableRenderable,
  type ChunkRenderContext,
  type InputRenderable,
  type MarkdownInlineHook,
  type MarkdownRenderable,
  type Renderable,
  type RGBA,
  type TextChunk,
} from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, For, on, onCleanup, Show, untrack } from "solid-js"
import { useCursorStyle } from "../../config"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { EmptyBorder, SplitBorder } from "../../ui/border"
import { useDialog } from "../../ui/dialog"
import { displayRanges, findRanges, paintChunks, type FindPart, type FindRange } from "./find"
import { use } from "./render-context"

export const FIND_MODE = "find"

/**
 * Takes the prompt's place while Find is open, in the prompt's shape: the query on the input row,
 * the match counter where the agent and model go and the keys in the footer. Incremental.
 */
export function FindBar(props: {
  query: string
  index: number
  count: number
  focus: number
  onInput: (value: string) => void
  onMove: (delta: 1 | -1) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const cursorStyle = useCursorStyle()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const keymap = Keymap.use()
  const active = () => dialog.stack.length === 0
  const background = createMemo(() => theme.decrease(theme.background.raised.base))
  let input: InputRenderable | undefined

  onCleanup(keymap.mode.push(FIND_MODE, active))
  Keymap.createLayer(() => ({
    mode: FIND_MODE,
    commands: [
      { bind: "return,down", title: "Next match", group: "Find", run: () => props.onMove(1) },
      { bind: "shift+return,up", title: "Previous match", group: "Find", run: () => props.onMove(-1) },
      { bind: "escape", title: "Close find", group: "Find", run: props.onClose },
    ],
  }))

  // The field keeps focus while Find is open: opening it again or closing a dialog refocuses it.
  createEffect(
    on([() => props.focus, active], () => {
      if (!active()) return
      setTimeout(() => {
        if (input && !input.isDestroyed) input.focus()
      }, 1)
    }),
  )

  return (
    <box width="100%">
      <box
        width="100%"
        border={["left"]}
        borderColor={theme.border.base}
        customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }}
      >
        <box
          paddingLeft={dimensions().width < 44 ? 1 : 2}
          paddingRight={dimensions().width < 44 ? 1 : 2}
          paddingTop={1}
          flexShrink={0}
          backgroundColor={background()}
          flexGrow={1}
          width="100%"
        >
          <input
            ref={input}
            width="100%"
            onInput={props.onInput}
            placeholder="Find in session..."
            placeholderColor={theme.text.muted}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            textColor={theme.text.base}
            focusedTextColor={theme.text.base}
            cursorColor={theme.text.base}
            cursorStyle={cursorStyle()}
          />
          <box flexDirection="row" flexShrink={0} paddingTop={1}>
            <text fg={theme.text.base} wrapMode="none">
              Find
              <Show when={props.query}>
                <span style={{ fg: theme.text.muted }}>
                  {" · "}
                  {props.count ? `${props.index + 1} of ${props.count}` : "No matches"}
                </span>
              </Show>
            </text>
          </box>
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={theme.border.base}
        customBorderChars={{ ...EmptyBorder, vertical: background().a !== 0 ? "╹" : " " }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={background()}
          customBorderChars={{ ...EmptyBorder, horizontal: background().a !== 0 ? "▀" : " " }}
        />
      </box>
      {/* The keys sit where the prompt's footer shows its shortcuts. */}
      <box width="100%" height={1} flexDirection="row" justifyContent="flex-end" gap={2}>
        <Show when={dimensions().width >= 50}>
          <text fg={theme.text.base} wrapMode="none" flexShrink={0}>
            enter <span style={{ fg: theme.text.muted }}>next</span>
          </text>
          <text fg={theme.text.base} wrapMode="none" flexShrink={0}>
            shift+enter <span style={{ fg: theme.text.muted }}>previous</span>
          </text>
        </Show>
        <text fg={theme.text.base} wrapMode="none" flexShrink={0}>
          esc <span style={{ fg: theme.text.muted }}>close</span>
        </text>
      </box>
    </box>
  )
}

/**
 * Returns a `<markdown>` ref, applied after `useSessionLinks()`, that paints the part's Find
 * matches into its paragraphs, headings, table cells and code blocks. The part's Nth match is the
 * Nth one it shows: the inline hook gets a block's source but not where it sits, and a short block
 * such as a table cell can repeat text from earlier in the part.
 */
export function useFindHighlight(part: () => FindPart) {
  const ctx = use()
  const theme = useTheme()
  let markdown: MarkdownRenderable | undefined
  let links: MarkdownInlineHook | undefined
  let filter: readonly string[] | undefined
  let marking = false
  const current = createMemo(() => {
    const match = ctx.find.current()
    return match?.messageID === part().messageID && match.partID === part().partID ? match.occurrence : -1
  })
  const found = createMemo(() => findRanges(part().text, ctx.find.pattern()).length > 0)
  const paintMatch = <Chunk extends { bg?: RGBA }>(chunk: Chunk) => ({ ...chunk, bg: theme.find.background.match })
  const paintCurrent = <Chunk extends { fg?: RGBA; bg?: RGBA }>(chunk: Chunk) => ({
    ...chunk,
    fg: theme.find.text.current,
    bg: theme.find.background.current,
  })

  // Paragraphs, headings and table cells, after session links. The current match is marked once the
  // blocks are written, when their order is known.
  const prose: MarkdownInlineHook = (spans, context) => {
    const linked = links ? links(spans, context) : spans
    const pattern = ctx.find.pattern()
    if (!pattern || !found()) return linked
    if (current() !== -1 && !marking) {
      marking = true
      queueMicrotask(markCurrent)
    }
    return paintChunks(linked, findRanges(linked.map((span) => span.text).join(""), pattern), paintMatch)
  }

  function markCurrent() {
    marking = false
    const pattern = ctx.find.pattern()
    const occurrence = current()
    if (!pattern || occurrence === -1 || !markdown || markdown.isDestroyed) return
    const item = shown(pattern).find((item) => occurrence < item.first + item.ranges.length)
    const range = item?.ranges[occurrence - item.first]
    if (!item?.paint || !range) return
    item.paint(range)
    // Table cells have no text node to scroll to; the reveal falls back to the part.
    const node = item.node
    if (node instanceof TextRenderable) ctx.find.located({ ...part(), occurrence }, () => node, range.start)
  }

  // Everything the part shows, in order, with the matches each piece shows and how many come before.
  function shown(pattern: RegExp) {
    const items = (markdown?.blocks ?? []).flatMap(({ renderable: node }): ShownItem[] => {
      if (node instanceof TextRenderable)
        return [
          {
            node,
            ranges: findRanges(node.plainText, pattern),
            paint: (range) => {
              node.content = new StyledText(paintChunks(node.content.chunks, [range], paintCurrent))
            },
          },
        ]
      // Code blocks paint their own current match in `code`.
      if (node instanceof CodeRenderable) return [{ node, ranges: findRanges(node.content, pattern) }]
      if (!(node instanceof TextTableRenderable)) return []
      return node.content.flatMap((row, r) =>
        row.flatMap((cell, c): ShownItem[] => {
          if (!cell) return []
          const paint = (range: FindRange) => {
            node.content = node.content.map((cells, i) =>
              i === r ? cells.map((value, j) => (j === c && value ? paintChunks(value, [range], paintCurrent) : value)) : cells,
            )
          }
          return [{ node, ranges: findRanges(cell.map((chunk) => chunk.text).join(""), pattern), paint }]
        }),
      )
    })
    const firsts = items.reduce((result, item) => [...result, result.at(-1)! + item.ranges.length], [0])
    return items.map((item, index) => ({ ...item, first: firsts[index]! }))
  }

  // Fenced code keeps OpenTUI's per-chunk source ranges, so it maps its matches onto its chunks exactly.
  function code(this: CodeRenderable, chunks: TextChunk[], context: ChunkRenderContext) {
    const pattern = ctx.find.pattern()
    if (!pattern || !found()) return chunks
    const first = shown(pattern).find((item) => item.node === this)?.first
    if (first === undefined) return chunks
    const ranges = findRanges(context.content, pattern).map((range, index) => ({
      ...range,
      current: first + index === current(),
    }))
    const display = displayRanges(chunks, context.sourceRanges ?? [], ranges)
    const target = display.find((range) => range.current)
    if (target) ctx.find.located({ ...part(), occurrence: current() }, () => this, target.start)
    return paintChunks(chunks, display, (chunk, range) => (range.current ? paintCurrent(chunk) : paintMatch(chunk)))
  }

  // Code blocks have no chunk callback until a query reaches them.
  function refresh(node: Renderable) {
    if (node instanceof CodeRenderable) {
      const callback = node.onChunks
      if (callback === code) {
        node.onChunks = undefined
        node.onChunks = callback
      }
      if (!callback) node.onChunks = code
    }
    node.getChildren().forEach(refresh)
  }

  // Not deferred: a part that mounts while Find is open paints its matches right away.
  createEffect(
    on([ctx.find.pattern, current], ([pattern], previous) => {
      const text = part().text
      const has = findRanges(text, pattern).length > 0
      if (!markdown || (!has && !findRanges(text, previous?.[0]).length)) return
      untrack(() => {
        // The hook filter matches exact text, so every block reaches the hook while the part has matches.
        markdown!.inlineHookFilter = has ? undefined : filter
        markdown!.rerunInlineHook(() => true)
        refresh(markdown!)
      })
    }),
  )

  return (renderable: MarkdownRenderable) => {
    markdown = renderable
    links = renderable.inlineHook
    filter = renderable.inlineHookFilter
    renderable.inlineHook = prose
  }
}

type ShownItem = { node: Renderable; ranges: FindRange[]; paint?: (range: FindRange) => void }

/** Plain transcript text with its Find matches painted. */
export function FindText(props: { part: FindPart; fg: TextRenderable["fg"] }) {
  const ctx = use()
  const theme = useTheme()
  let node: TextRenderable | undefined
  const current = createMemo(() => {
    const match = ctx.find.current()
    return match?.messageID === props.part.messageID && match.partID === props.part.partID ? match.occurrence : -1
  })
  const ranges = createMemo(() => findRanges(props.part.text, ctx.find.pattern()))
  const pieces = createMemo(() => {
    const cuts = [0, ...ranges().flatMap((range) => [range.start, range.end]), props.part.text.length]
    return cuts.slice(1).map((end, index) => ({
      text: props.part.text.slice(cuts[index], end),
      // Odd pieces are matches.
      occurrence: index % 2 ? (index - 1) / 2 : undefined,
    }))
  })

  createEffect(() => {
    const occurrence = current()
    const range = ranges()[occurrence]
    if (node && range) ctx.find.located({ ...props.part, occurrence }, () => node, range.start)
  })

  return (
    <text ref={node} fg={props.fg}>
      <Show when={ranges().length} fallback={props.part.text}>
        <For each={pieces()}>
          {(piece) => (
            <Show when={piece.occurrence !== undefined} fallback={piece.text}>
              <span
                style={
                  piece.occurrence === current()
                    ? { fg: theme.find.text.current, bg: theme.find.background.current }
                    : { bg: theme.find.background.match }
                }
              >
                {piece.text}
              </span>
            </Show>
          )}
        </For>
      </Show>
    </text>
  )
}
