import {
  CodeRenderable,
  type ChunkRenderContext,
  type InputRenderable,
  type MarkdownRenderable,
  type OnChunksCallback,
  type Renderable,
  type TextChunk,
  type TextRenderable,
} from "@opentui/core"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from "solid-js"
import { useCursorStyle } from "../../config"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { displayRanges, findRanges, paintChunks, type FindPart } from "./find"
import { use } from "./render-context"

export const FIND_MODE = "find"

/** One-line Find bar above the composer, like the web app's: incremental, with a match counter. */
export function FindBar(props: {
  query: string
  index: number
  count: number
  focus: number
  onInput: (value: string) => void
  onMove: (delta: 1 | -1) => void
  onClose: () => void
}) {
  const ctx = use()
  const theme = useTheme()
  const cursorStyle = useCursorStyle()
  const keymap = Keymap.use()
  const [focused, setFocused] = createSignal(false)
  let input: InputRenderable | undefined

  // Claims Enter, arrows and Escape only while the field has focus, so the prompt keeps its keys.
  onCleanup(keymap.mode.push(FIND_MODE, focused))
  Keymap.createLayer(() => ({
    mode: FIND_MODE,
    commands: [
      { bind: "return,down", title: "Next match", group: "Find", run: () => props.onMove(1) },
      { bind: "shift+return,up", title: "Previous match", group: "Find", run: () => props.onMove(-1) },
      { bind: "escape", title: "Close find", group: "Find", run: props.onClose },
    ],
  }))

  // Opening Find again refocuses the field.
  createEffect(
    on(
      () => props.focus,
      () =>
        setTimeout(() => {
          if (input && !input.isDestroyed) input.focus()
        }, 1),
    ),
  )

  return (
    <box
      marginBottom={1}
      border={["left"]}
      borderColor={theme.border.base}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={2}
        backgroundColor={theme.background.raised.base}
      >
        <input
          ref={(element: InputRenderable) => {
            input = element
            element.on("focused", () => setFocused(true))
            element.on("blurred", () => setFocused(false))
          }}
          flexGrow={1}
          minWidth={10}
          onInput={props.onInput}
          placeholder="Find..."
          placeholderColor={theme.text.muted}
          backgroundColor={theme.background.raised.base}
          focusedBackgroundColor={theme.background.raised.base}
          textColor={theme.text.base}
          focusedTextColor={theme.text.base}
          cursorColor={theme.text.base}
          cursorStyle={cursorStyle()}
        />
        <Show when={props.query}>
          <text fg={theme.text.muted} flexShrink={0}>
            {props.count ? props.index + 1 : 0}/{props.count}
          </text>
        </Show>
        <Show when={ctx.width >= 80}>
          <text fg={theme.text.muted} flexShrink={0} wrapMode="none">
            <span style={{ fg: theme.text.base }}>enter</span> next{" "}
            <span style={{ fg: theme.text.base }}>shift+enter</span> previous{" "}
            <span style={{ fg: theme.text.base }}>esc</span> close
          </text>
        </Show>
      </box>
    </box>
  )
}

/**
 * Returns a `<markdown>` ref, applied after `useSessionLinks()`, that paints the part's Find
 * matches into every prose and code block. Matches are counted on the part's markdown source, so
 * each block maps the ones inside its own source onto its displayed chunks; matches in tables
 * are counted but not painted.
 */
export function useFindHighlight(part: () => FindPart) {
  const ctx = use()
  const theme = useTheme()
  let markdown: MarkdownRenderable | undefined
  let links: OnChunksCallback | undefined
  const current = createMemo(() => {
    const match = ctx.find.current()
    return match?.messageID === part().messageID && match.partID === part().partID ? match.occurrence : -1
  })

  // OpenTUI calls these as methods of each block. Prose blocks keep the session links' chunks.
  async function prose(this: CodeRenderable, chunks: TextChunk[], context: ChunkRenderContext) {
    const linked = (await links?.call(this, chunks, context)) ?? chunks
    if (!ctx.find.pattern()) return linked
    // A session link label replaces its ID, so the source no longer lines up with the text.
    if (linked.map((chunk) => chunk.text).join("") !== chunks.map((chunk) => chunk.text).join("")) return linked
    return paint(this, linked, context)
  }
  function code(this: CodeRenderable, chunks: TextChunk[], context: ChunkRenderContext) {
    return paint(this, chunks, context)
  }

  function paint(block: CodeRenderable, chunks: TextChunk[], context: ChunkRenderContext) {
    // Cheap checks first: this runs for every block on every highlight, streaming included.
    const matches = findRanges(part().text, ctx.find.pattern())
    if (matches.length === 0 || !markdown) return chunks
    const start = sourceStart(markdown, part().text, block)
    if (start === undefined) return chunks
    const end = start + context.content.length
    const ranges = matches.flatMap((range, occurrence) =>
      range.start >= start && range.end <= end
        ? [{ start: range.start - start, end: range.end - start, current: occurrence === current() }]
        : [],
    )
    const shown = displayRanges(chunks, context.sourceRanges ?? [], ranges)
    const target = shown.find((range) => range.current)
    if (target) ctx.find.located({ ...part(), occurrence: current() }, block, target.start)
    return paintChunks(chunks, shown, (chunk, range) =>
      range.current
        ? { ...chunk, fg: theme.find.text.current, bg: theme.find.background.current }
        : { ...chunk, bg: theme.find.background.match },
    )
  }

  // Re-highlights the blocks of a part whose matches changed. Fenced code blocks have no chunk
  // callback until a query reaches them.
  function refresh(node: Renderable) {
    if (node instanceof CodeRenderable) {
      const callback = node.onChunks
      if (callback === prose || callback === code) {
        node.onChunks = undefined
        node.onChunks = callback
      }
      if (!callback && node.filetype !== "markdown") node.onChunks = code
    }
    node.getChildren().forEach(refresh)
  }

  createEffect(
    on(
      [ctx.find.pattern, current],
      ([pattern], previous) => {
        const text = part().text
        if (!markdown || (!findRanges(text, pattern).length && !findRanges(text, previous?.[0]).length)) return
        untrack(() => refresh(markdown!))
      },
      { defer: true },
    ),
  )

  // Solid calls refs before setting content, so every prose block markdown creates picks up `prose`.
  return (renderable: MarkdownRenderable) => {
    markdown = renderable
    // oxlint-disable-next-line no-restricted-globals -- OpenTUI has no public option for the markdown chunk callback.
    links = Reflect.get(renderable, "_linkifyMarkdownChunks")
    // oxlint-disable-next-line no-restricted-globals -- OpenTUI has no public option for the markdown chunk callback.
    Reflect.set(renderable, "_linkifyMarkdownChunks", prose)
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
    if (node && range) ctx.find.located({ ...props.part, occurrence }, node, range.start)
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
