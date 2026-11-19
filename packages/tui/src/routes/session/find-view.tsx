import {
  CodeRenderable,
  TextRenderable,
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
import { displayRanges, findRanges, paintChunks, type FindPart } from "./find"
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
 * matches into its paragraphs, headings, table cells and code blocks. Matches are counted on the
 * part's markdown source, so each block marks the ones inside its own source.
 */
export function useFindHighlight(part: () => FindPart) {
  const ctx = use()
  const theme = useTheme()
  let markdown: MarkdownRenderable | undefined
  let links: MarkdownInlineHook | undefined
  let filter: readonly string[] | undefined
  const current = createMemo(() => {
    const match = ctx.find.current()
    return match?.messageID === part().messageID && match.partID === part().partID ? match.occurrence : -1
  })
  const paint = <Chunk extends { fg?: RGBA; bg?: RGBA }>(chunk: Chunk, range: { current: boolean }) =>
    range.current
      ? { ...chunk, fg: theme.find.text.current, bg: theme.find.background.current }
      : { ...chunk, bg: theme.find.background.match }

  // Prose shows no source offsets, so its matches are found in the text it shows, after session
  // links, and numbered from the first match in its source.
  const prose: MarkdownInlineHook = (spans, context) => {
    const linked = links ? links(spans, context) : spans
    const matches = findRanges(part().text, ctx.find.pattern())
    if (matches.length === 0) return linked
    const start = part().text.indexOf(context.source)
    const end = start + context.source.length
    const first = matches.findIndex((range) => range.start >= start && range.end <= end)
    const text = linked.map((span) => span.text).join("")
    const shown = findRanges(text, ctx.find.pattern()).map((range, index) => ({
      ...range,
      current: start !== -1 && first !== -1 && first + index === current() && matches[first + index]!.end <= end,
    }))
    const target = shown.find((range) => range.current)
    // Table cells have no text node to scroll to; the reveal falls back to the part.
    if (target && !context.tableCell)
      ctx.find.located({ ...part(), occurrence: current() }, () => proseNode(text), target.start)
    return paintChunks(linked, shown, paint)
  }

  // Fenced code keeps OpenTUI's per-chunk source ranges, so it maps the source matches exactly.
  function code(this: CodeRenderable, chunks: TextChunk[], context: ChunkRenderContext) {
    const matches = findRanges(part().text, ctx.find.pattern())
    if (matches.length === 0 || !markdown) return chunks
    const start = sourceStart(markdown, part().text, this)
    if (start === undefined) return chunks
    const end = start + context.content.length
    const ranges = matches.flatMap((range, occurrence) =>
      range.start >= start && range.end <= end
        ? [{ start: range.start - start, end: range.end - start, current: occurrence === current() }]
        : [],
    )
    const shown = displayRanges(chunks, context.sourceRanges ?? [], ranges)
    const target = shown.find((range) => range.current)
    if (target) ctx.find.located({ ...part(), occurrence: current() }, () => this, target.start)
    return paintChunks(chunks, shown, paint)
  }

  function proseNode(text: string) {
    return markdown?.blocks.flatMap((block) =>
      block.renderable instanceof TextRenderable && block.renderable.plainText === text ? [block.renderable] : [],
    )[0]
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
      const found = findRanges(text, pattern).length > 0
      if (!markdown || (!found && !findRanges(text, previous?.[0]).length)) return
      untrack(() => {
        // The hook filter matches exact text, so every block reaches the hook while the part has matches.
        markdown!.inlineHookFilter = found ? undefined : filter
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

/** Where a block's source starts in the part's markdown: blocks are its slices, in tree order. */
function sourceStart(markdown: MarkdownRenderable, text: string, block: CodeRenderable) {
  const blocks: CodeRenderable[] = []
  const visit = (node: Renderable): void => {
    if (node instanceof CodeRenderable) blocks.push(node)
    node.getChildren().forEach(visit)
  }
  visit(markdown)
  let cursor = 0
  for (const item of blocks) {
    const start = text.indexOf(item.content, cursor)
    if (item === block) return start === -1 ? undefined : start
    if (start !== -1) cursor = start + item.content.length
  }
}

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
