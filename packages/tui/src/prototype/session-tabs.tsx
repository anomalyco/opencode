// PROTOTYPE: interactive session-tab treatments. Delete after choosing a direction.
import { RGBA, TextAttributes } from "@opentui/core"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createMemo, createSignal } from "solid-js"
import { sessionTabWindow } from "../context/session-tabs-model"
import { TabPulse } from "../component/tab-pulse"
import { TabShadow } from "../component/tab-shadow"

const colors = {
  background: RGBA.fromHex("#1a1b26"),
  surface: RGBA.fromHex("#222436"),
  surfaceHigh: RGBA.fromHex("#292b41"),
  text: RGBA.fromHex("#c8d3f5"),
  subdued: RGBA.fromHex("#828bb8"),
  faint: RGBA.fromHex("#454a68"),
  accent: RGBA.fromHex("#c099ff"),
  warning: RGBA.fromHex("#ffc777"),
  error: RGBA.fromHex("#ff757f"),
}

const variants = [
  { name: "Rails", note: "Contiguous tabs with a quiet leading rail." },
  { name: "Hairlines", note: "Shared separators; no inactive surfaces." },
  { name: "Islands", note: "Raised tab chips separated by one clear cell." },
  { name: "Notches", note: "Selected tab uses a top notch instead of a filled block." },
  { name: "Brackets", note: "Compact terminal-native labels with explicit edges." },
] as const

const shadows = [
  { name: "none", strength: 0 },
  { name: "soft", strength: 0.08 },
  { name: "medium", strength: 0.16 },
  { name: "strong", strength: 0.28 },
] as const

const samples = [
  { sessionID: "a", title: "TUI tabs architecture", state: "idle" },
  { sessionID: "b", title: "Voice session controls", state: "running" },
  { sessionID: "c", title: "Provider migration", state: "unread" },
  { sessionID: "d", title: "OpenCode hot reload", state: "error" },
  { sessionID: "e", title: "Permission flow", state: "attention" },
  { sessionID: "f", title: "Theme contrast", state: "idle" },
  { sessionID: "g", title: "Overflow behavior", state: "unread" },
  { sessionID: "h", title: "Keyboard map", state: "idle" },
  { sessionID: "i", title: "Tab persistence", state: "running" },
  { sessionID: "j", title: "Final polish", state: "idle" },
] as const

type Variant = (typeof variants)[number]["name"]
type Sample = (typeof samples)[number]

function Prototype() {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [variant, setVariant] = createSignal(0)
  const [active, setActive] = createSignal(3)
  const [shadow, setShadow] = createSignal(2)
  const [count, setCount] = createSignal(7)

  const move = (value: number, delta: number, length: number) => (value + delta + length) % length
  useKeyboard((event) => {
    if ((event.ctrl && event.name === "c") || event.name === "q") return renderer.destroy()
    if (event.name === "left" || event.name === "h") return setActive((value) => move(value, -1, count()))
    if (event.name === "right" || event.name === "l") return setActive((value) => move(value, 1, count()))
    if (event.name === "up" || event.name === "k") return setVariant((value) => move(value, -1, variants.length))
    if (event.name === "down" || event.name === "j") return setVariant((value) => move(value, 1, variants.length))
    if (event.name === "s") return setShadow((value) => move(value, 1, shadows.length))
    if (event.name === "o") {
      const next = count() === 4 ? 7 : count() === 7 ? 10 : 4
      setCount(next)
      setActive((value) => Math.min(value, next - 1))
    }
    const number = Number(event.name)
    if (number >= 1 && number <= variants.length) setVariant(number - 1)
  })

  const current = () => variants[variant()]!
  const currentShadow = () => shadows[shadow()]!

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
      <box height={3} flexShrink={0} paddingLeft={2} paddingRight={2} flexDirection="column">
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          SESSION TAB LAB
        </text>
        <text fg={colors.subdued}>PROTOTYPE · evaluate structure in real terminal cells</text>
      </box>

      <box flexShrink={0} flexDirection="column">
        <TabStrip
          variant={current().name}
          active={active()}
          count={count()}
          width={dimensions().width}
          shadow={currentShadow().strength}
          interactive
          onSelect={setActive}
        />
        <box height={7} paddingLeft={3} flexDirection="column">
          <text fg={colors.text}>import &#123; SessionTabs &#125; from &quot;./component/session-tabs&quot;</text>
          <text fg={colors.subdued}>const active = tabs.current()</text>
          <text fg={colors.subdued}>const visible = sessionTabWindow(tabs, active, available)</text>
          <text fg={colors.text}>The first content row should fade beneath the strip without disappearing.</text>
          <text fg={colors.faint}>Resize the terminal to pressure-test overflow and active-tab visibility.</text>
        </box>
      </box>

      <box height={3} flexShrink={0} paddingLeft={2} flexDirection="column">
        <text fg={colors.accent} attributes={TextAttributes.BOLD}>
          {variant() + 1}/{variants.length} · {current().name}
        </text>
        <text fg={colors.subdued}>{current().note}</text>
      </box>

      <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} flexDirection="column" gap={1}>
        <text fg={colors.faint}>COMPARISON SHELF</text>
        <For each={variants}>
          {(item, index) => (
            <box flexDirection="row" height={1} onMouseUp={() => setVariant(index())}>
              <text width={14} fg={index() === variant() ? colors.accent : colors.subdued}>
                {index() === variant() ? "› " : "  "}
                {index() + 1} {item.name}
              </text>
              <box flexGrow={1} minWidth={0}>
                <TabStrip
                  variant={item.name}
                  active={active()}
                  count={Math.min(count(), 5)}
                  width={Math.max(20, dimensions().width - 18)}
                  shadow={0}
                  onSelect={setActive}
                />
              </box>
            </box>
          )}
        </For>
      </box>

      <box height={3} flexShrink={0} backgroundColor={colors.surface} paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text}>←/→ active tab · ↑/↓ variant · 1–5 choose · s shadow · o overflow · q quit</text>
          <text fg={colors.accent}>
            shadow: {currentShadow().name} · tabs: {count()}
          </text>
        </box>
      </box>
    </box>
  )
}

function TabStrip(props: {
  variant: Variant
  active: number
  count: number
  width: number
  shadow: number
  interactive?: boolean
  onSelect: (index: number) => void
}) {
  const tabs = () => samples.slice(0, props.count)
  const gap = () => (props.variant === "Islands" ? 1 : 0)
  const markerWidth = 3
  const tabWidth = createMemo(() => {
    const ideal = props.variant === "Brackets" ? 18 : 22
    return Math.max(10, Math.min(ideal, props.width - 8))
  })
  const visible = createMemo(() => {
    const initial = sessionTabWindow(
      tabs(),
      tabs()[props.active]?.sessionID,
      Math.max(1, Math.floor(props.width / tabWidth())),
    )
    const markers = (initial.before > 0 ? markerWidth : 0) + (initial.after > 0 ? markerWidth : 0)
    const count = Math.max(1, Math.floor((props.width - markers) / (tabWidth() + gap())))
    return sessionTabWindow(tabs(), tabs()[props.active]?.sessionID, count)
  })

  return (
    <box height={1} width="100%" position="relative" flexDirection="row" gap={gap()}>
      <Show when={props.shadow > 0}>
        <TabShadow strength={props.shadow} color={colors.background} />
      </Show>
      <Show when={visible().before > 0}>
        <text width={markerWidth} fg={colors.subdued}>
          ‹{visible().before}
        </text>
      </Show>
      <For each={visible().tabs}>
        {(tab) => (
          <Tab
            tab={tabs().find((item) => item.sessionID === tab.sessionID)!}
            index={tabs().findIndex((item) => item.sessionID === tab.sessionID)}
            width={tabWidth()}
            variant={props.variant}
            selected={tabs()[props.active]?.sessionID === tab.sessionID}
            pulse={Boolean(props.interactive)}
            onSelect={props.onSelect}
          />
        )}
      </For>
      <Show when={visible().after > 0}>
        <text width={markerWidth} fg={colors.subdued}>
          {visible().after}›
        </text>
      </Show>
    </box>
  )
}

function Tab(props: {
  tab: Sample
  index: number
  width: number
  variant: Variant
  selected: boolean
  pulse: boolean
  onSelect: (index: number) => void
}) {
  const status = () => {
    if (props.tab.state === "attention") return { text: "!", color: colors.warning }
    if (props.tab.state === "error") return { text: "•", color: colors.error }
    if (props.tab.state === "unread") return { text: "•", color: colors.accent }
    return { text: " ", color: colors.subdued }
  }
  const background = () => {
    if (props.variant === "Islands") return props.selected ? colors.surfaceHigh : colors.surface
    if (props.selected && props.variant !== "Hairlines" && props.variant !== "Brackets") return colors.surface
  }
  const edge = () => {
    if (props.variant === "Rails") return "▏"
    if (props.variant === "Hairlines") return "│"
    if (props.variant === "Notches") return props.selected ? "▔" : " "
    if (props.variant === "Brackets") return props.selected ? "[" : "·"
    return " "
  }
  const end = () => (props.variant === "Brackets" && props.selected ? "]" : " ")
  const titleWidth = () => Math.max(2, props.width - 6)
  const foreground = () => (props.selected ? colors.text : colors.subdued)

  return (
    <box
      width={props.width}
      height={1}
      position="relative"
      flexDirection="row"
      backgroundColor={background()}
      onMouseUp={() => props.onSelect(props.index)}
    >
      <Show when={props.pulse && props.tab.state === "running"}>
        <TabPulse active color={colors.accent} backgroundColor={background() ?? colors.background} />
      </Show>
      <box zIndex={1} width="100%" flexDirection="row">
        <text width={1} fg={props.selected ? colors.accent : colors.faint}>
          {edge()}
        </text>
        <text width={1} fg={status().color}>
          {status().text}
        </text>
        <text width={2} fg={props.tab.state === "error" ? colors.error : props.selected ? colors.accent : foreground()}>
          {props.index + 1}
        </text>
        <text width={titleWidth()} fg={foreground()} wrapMode="none">
          {props.tab.title.slice(0, titleWidth() - 1)}
        </text>
        <text width={1} fg={props.selected ? colors.accent : colors.faint}>
          {end()}
        </text>
      </box>
    </box>
  )
}

await render(() => <Prototype />, {
  backgroundColor: colors.background,
  exitOnCtrlC: false,
  useMouse: true,
})
