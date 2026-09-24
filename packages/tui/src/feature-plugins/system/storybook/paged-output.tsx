import type { Plugin } from "@opencode/plugin/tui"
import { CliRenderEvents, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  adjacentPageTop,
  createPagedScroll,
  PAGED_OUTPUT_OVERLAP_LINES,
  pageStep,
  pageTarget,
} from "../../../routes/session/paged-scroll"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

// Streaming output is simulated line by line; each appended line grows the transcript by a row,
// which is the event that used to make native sticky-follow bounce. The scroll box and the paging
// controller below are the production ones, so the movement counters report real regressions.
const SENTENCES = [
  "The transcript grows a row at a time, and with native sticky-follow every row nudges the viewport before the page padding catches up.",
  "Paged follow pins the viewport to whole-page boundaries, so a page fills from the top down without moving the lines already on screen.",
  "When the last row of a page arrives, the viewport jumps a full page and the next row starts a fresh page at the top.",
  "Scrolling away pauses follow; returning to the bottom of the current page resumes it.",
  "The counters below treat any movement smaller than half a page as jitter, so a clean run should only accumulate full-page jumps.",
  "A wrapped line can grow by more than one row at once, which is why the fixture mixes short and long sentences.",
]

const LINES = Array.from({ length: 400 }, (_, index) => `${String(index + 1).padStart(3, "0")}  ${SENTENCES[index % SENTENCES.length]}`)

const OVERLAPS = [0, 1, 3, 5, 8]
const nextOverlap = (current: number) => OVERLAPS[(OVERLAPS.indexOf(current) + 1) % OVERLAPS.length] ?? 0

function PagedOutputStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const theme = props.context.theme
  let scroll: ScrollBoxRenderable | undefined
  const [lines, setLines] = createSignal<string[]>([])
  const [auto, setAuto] = createSignal(true)
  const [overlap, setOverlap] = createSignal(PAGED_OUTPUT_OVERLAP_LINES)
  const [stats, setStats] = createStore({ steps: 0, moves: 0, movement: 0, jitter: 0 })
  const [reading, setReading] = createSignal({ top: 0, target: 0, pad: 0, max: 0, page: 0 })

  const paged = createPagedScroll({
    enabled: () => true,
    scroll: () => scroll,
    suspended: () => false,
    overlap,
    renderer,
  })

  const reset = () => {
    setLines([])
    setStats({ steps: 0, moves: 0, movement: 0, jitter: 0 })
    paged.setFollowing(true)
  }

  const step = () =>
    setLines((current) => {
      if (current.length >= LINES.length) return current
      setStats("steps", (value) => value + 1)
      return [...current, LINES[current.length]!]
    })

  const jumpToLatest = () => {
    if (!scroll || scroll.isDestroyed) return
    paged.setFollowing(true)
    scroll.scrollTo(scroll.scrollHeight)
  }

  const movePage = (direction: -1 | 1) => {
    const geometry = paged.geometry()
    if (!geometry || !scroll || scroll.isDestroyed) return
    const target = Math.min(Math.max(0, adjacentPageTop(scroll.scrollTop, geometry.step, direction)), geometry.latest)
    if (target !== scroll.scrollTop) scroll.scrollTo(target)
    paged.setFollowing(target >= geometry.latest)
  }

  createEffect(() => {
    if (!auto()) return
    const timer = setInterval(step, 240)
    onCleanup(() => clearInterval(timer))
  })

  let lastTop = 0
  createEffect(() => {
    const listener = () => {
      if (!scroll || scroll.isDestroyed) return
      const page = Math.max(1, scroll.viewport.height)
      const step = pageStep(page, overlap())
      const top = scroll.scrollTop
      const delta = Math.abs(top - lastTop)
      if (delta > 0) {
        setStats("moves", (value) => value + 1)
        setStats("movement", (value) => value + delta)
        // A clean page flip advances by exactly one step; anything else is a mid-page adjustment.
        if (delta !== step) setStats("jitter", (value) => value + 1)
      }
      lastTop = top
      setReading({
        top,
        page,
        pad: paged.padding(),
        max: Math.max(0, scroll.scrollHeight - page),
        target: pageTarget(Math.max(0, scroll.scrollHeight - paged.padding()), page, overlap()),
      })
    }
    renderer.on(CliRenderEvents.FRAME, listener)
    onCleanup(() => renderer.off(CliRenderEvents.FRAME, listener))
  })

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "space", title: "Pause / resume stream", group: "Storybook", run: () => setAuto((value) => !value) },
      { bind: "s", title: "Append one line", group: "Storybook", run: step },
      { bind: "pageup", title: "Previous page", group: "Storybook", run: () => movePage(-1) },
      { bind: "pagedown", title: "Next page", group: "Storybook", run: () => movePage(1) },
      { bind: "o", title: "Cycle page overlap", group: "Storybook", run: () => setOverlap(nextOverlap) },
      { bind: "r", title: "Reset", group: "Storybook", run: reset },
      { bind: "g", title: "Jump to latest", group: "Storybook", run: jumpToLatest },
    ],
  }))

  const read = () => reading()
  const stat = () =>
    `${lines().length} lines · ${stats.moves} moves · ${stats.movement} rows moved · ${stats.jitter} jitter · ${overlap()} line overlap`

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.base}
    >
      <box height={1} flexShrink={0} paddingLeft={1} flexDirection="row">
        <text fg={theme.text.base}>paged output.</text>
        <text fg={theme.text.muted}>
          {" "}
          watch the last rows: they should stay put until the page is full, then jump a whole page
        </text>
      </box>
      <scrollbox
        ref={(value: ScrollBoxRenderable) => {
          scroll = value
          paged.setFollowing(true)
        }}
        flexGrow={1}
        minHeight={1}
        stickyScroll={false}
        stickyStart="bottom"
        viewportOptions={{ paddingRight: 1 }}
        verticalScrollbarOptions={{ visible: true, paddingLeft: 1, trackOptions: { foregroundColor: theme.border.base } }}
      >
        <For each={lines()}>
          {(line) => (
            <text width="100%" wrapMode="word" fg={theme.text.base}>
              {line}
            </text>
          )}
        </For>
      </scrollbox>
      <box flexShrink={0} paddingLeft={1} paddingRight={1} flexDirection="column">
        <text fg={theme.text.muted}>
          {stat()}
          <Show when={stats.jitter > 0}>
            <span style={{ fg: theme.text.feedback.warning.base }}> ← sub-page movement</span>
          </Show>
        </text>
        <text fg={theme.text.muted}>
          top {read().top} · target {read().target} · max {read().max} · pad {read().pad} · page {read().page} ·{" "}
          {paged.following() ? "following" : "paused"}
        </text>
      </box>
      <StoryFooter
        context={props.context}
        title="paged output"
        details={[auto() ? "streaming" : "paused"]}
        controls={[
          { shortcut: "space", label: "pause" },
          { shortcut: "s", label: "step" },
          { shortcut: "pgup/pgdn", label: "page" },
          { shortcut: "o", label: "overlap" },
          { shortcut: "g", label: "latest" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const pagedOutputStory: Story = {
  id: "paged-output",
  title: "paged output",
  render: (context) => <PagedOutputStory context={context} />,
}
