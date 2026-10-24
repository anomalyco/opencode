import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { HIDDEN_PAGE_SIZES, type HiddenEdge, type HiddenMessages } from "../../context/sync"
import { useTheme } from "../../context/theme"

// Loading every hidden message, measured on ten real sessions of 2,900 to
// 13,300 messages, cost a median of 9.3 ms before the transcript showed and
// 0.52 MB of TUI memory per message. The label warns once the estimate for
// this gap passes a 3 s freeze or 250 MB, about a third of an idle TUI.
const LOAD_ALL_MS_PER_MESSAGE = 10
const LOAD_ALL_MB_PER_MESSAGE = 0.5
const LOAD_ALL_SLOW_MS = 3000
const LOAD_ALL_HEAVY_MB = 250

export type HiddenAction = { edge: HiddenEdge; size?: number; label: string }

export function loadAllNote(count: number) {
  const notes = [
    count * LOAD_ALL_MS_PER_MESSAGE >= LOAD_ALL_SLOW_MS ? "slow" : undefined,
    count * LOAD_ALL_MB_PER_MESSAGE >= LOAD_ALL_HEAVY_MB ? "memory heavy" : undefined,
  ].filter((note): note is string => note !== undefined)
  return notes.length > 0 ? ` (${notes.join(" / ")})` : ""
}

// Pages are offered only while they are smaller than the gap; a page that
// would load the whole gap is "load all". When the count and "load all" do
// not fit on the rule together, the rule keeps the count and "load all" gets
// a row of its own.
export function hiddenDivider(count: number, width: number) {
  const pages = HIDDEN_PAGE_SIZES.filter((size) => size < count)
  const all: HiddenAction = { edge: "all", label: `load all${loadAllNote(count)}` }
  const shown = count.toLocaleString("en-US")
  const title = [`${shown} ${count === 1 ? "message" : "messages"} hidden:  `, `${shown} hidden:  `].find(
    (text) => text.length + all.label.length + 4 <= width,
  )
  return {
    above: pages.map((size): HiddenAction => ({ edge: "above", size, label: `load ${size} above` })),
    below: pages.map((size): HiddenAction => ({ edge: "below", size, label: `load ${size} below` })),
    all,
    title: title ?? `${shown} hidden`,
    inline: title !== undefined,
  }
}

export function HiddenMessagesDivider(props: {
  hidden: HiddenMessages
  width: number
  first: boolean
  onLoad: (edge: HiddenEdge, size?: number) => void
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const layout = createMemo(() => hiddenDivider(props.hidden.count, props.width))
  const loading = (action: HiddenAction) =>
    props.hidden.loading?.edge === action.edge && props.hidden.loading.size === action.size
  const text = (action: HiddenAction) => (loading(action) ? "loading…" : action.label)
  const rule = createMemo(() => {
    const inner = ` ${layout().title}${layout().inline ? text(layout().all) : ""} `
    const space = Math.max(2, props.width - inner.length)
    return ["─".repeat(Math.floor(space / 2)), "─".repeat(space - Math.floor(space / 2))]
  })

  function Action(action: HiddenAction) {
    const [hover, setHover] = createSignal(false)
    return (
      <text
        flexShrink={0}
        wrapMode="none"
        fg={props.hidden.loading ? theme.textMuted : hover() ? theme.text : theme.primary}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => {
          if (props.hidden.loading) return
          if (renderer.getSelection()?.getSelectedText()) return
          props.onLoad(action.edge, action.size)
        }}
      >
        {text(action)}
      </text>
    )
  }

  function Row(row: { actions: HiddenAction[] }) {
    return (
      <Show when={row.actions.length > 0}>
        <box flexDirection="row" justifyContent="center" gap={3}>
          <For each={row.actions}>{(action) => <Action {...action} />}</For>
        </box>
      </Show>
    )
  }

  return (
    <box id="hidden-messages" marginTop={props.first ? 0 : 1} flexShrink={0}>
      <Row actions={layout().above} />
      <box flexDirection="row">
        <text fg={theme.border} wrapMode="none" flexShrink={0}>
          {rule()[0]} <span style={{ fg: theme.textMuted }}>{layout().title}</span>
        </text>
        <Show when={layout().inline}>
          <Action {...layout().all} />
        </Show>
        <text fg={theme.border} wrapMode="none" flexShrink={0}>
          {" "}
          {rule()[1]}
        </text>
      </box>
      <Show when={!layout().inline}>
        <Row actions={[layout().all]} />
      </Show>
      <Row actions={layout().below} />
    </box>
  )
}
