// PROTOTYPE: interactive session-tab treatments. Delete after choosing a direction.
import { RGBA, TextAttributes } from "@opentui/core"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { TabPulse, type PulseEasing } from "../component/tab-pulse"
import { drawTabShadow } from "../component/tab-shadow"

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
const blend = (from: RGBA, to: RGBA, amount: number) =>
  RGBA.fromValues(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
    from.a + (to.a - from.a) * amount,
  )

const TAB_WIDTH = 22
const MIN_TAB_WIDTH = 8
const ADAPTIVE_SPRING = { visualDuration: 0.1, bounce: 0 } as const

const variants = [
  { name: "Rails", note: "Contiguous tabs with a quiet leading rail." },
  { name: "Islands", note: "Raised tab chips separated by one clear cell." },
  { name: "Adaptive", note: "Active tab expands while its neighbors contract with a critical spring." },
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

const pulses = [
  { name: "Laser", duration: 1_400, easing: "linear", head: 2, tail: 7, channel: "background" },
  { name: "Balanced", duration: 2_200, easing: "smooth", head: 4, tail: 14, channel: "background" },
  { name: "Current", duration: 2_800, easing: "coast", head: 4, tail: 18, channel: "background" },
  { name: "Comet", duration: 2_400, easing: "coast", head: 2, tail: 30, channel: "background" },
  { name: "Breathing", duration: 3_800, easing: "sine", head: 8, tail: 24, channel: "background" },
  { name: "Spring", duration: 2_400, easing: "spring", head: 4, tail: 14, channel: "background" },
  { name: "Bounce", duration: 2_800, easing: "bounce", head: 3, tail: 12, channel: "background" },
  { name: "Scanner", duration: 3_200, easing: "scanner", head: 3, tail: 10, channel: "background" },
  { name: "Text wave", duration: 2_800, easing: "coast", head: 4, tail: 12, channel: "foreground" },
] satisfies ReadonlyArray<{
  name: string
  duration: number
  easing: PulseEasing
  head: number
  tail: number
  channel: "background" | "foreground"
}>

type Variant = (typeof variants)[number]["name"]
type Sample = {
  sessionID: string
  title: string
  state: "idle" | "running" | "unread" | "error" | "attention"
}
type Pane = "tabs" | "pulse" | "state"

function Prototype() {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [variant, setVariant] = createSignal(0)
  const [active, setActive] = createSignal(3)
  const [count, setCount] = createSignal(7)
  const [pane, setPane] = createSignal<Pane>("tabs")

  const move = (value: number, delta: number, length: number) => (value + delta + length) % length
  useKeyboard((event) => {
    if ((event.ctrl && event.name === "c") || event.name === "q") return renderer.destroy()
    if (event.name === "left" || event.name === "h") return setActive((value) => move(value, -1, count()))
    if (event.name === "right" || event.name === "l") return setActive((value) => move(value, 1, count()))
    if (event.name === "up" || event.name === "k") return setVariant((value) => move(value, -1, variants.length))
    if (event.name === "down" || event.name === "j") return setVariant((value) => move(value, 1, variants.length))
    if (event.name === "p") {
      const panes: Pane[] = ["tabs", "pulse", "state"]
      return setPane((value) => panes[(panes.indexOf(value) + 1) % panes.length]!)
    }
    if (event.name === "o") {
      const next = count() === 4 ? 7 : count() === 7 ? 10 : 4
      setCount(next)
      setActive((value) => Math.min(value, next - 1))
    }
    const number = Number(event.name)
    if (number >= 1 && number <= Math.min(9, count())) setActive(number - 1)
  })

  const current = () => variants[variant()]!

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
          interactive
          onSelect={setActive}
        />
        <box height={5} paddingLeft={3} flexDirection="column">
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
        <Show
          when={pane() === "tabs"}
          fallback={
            <Show when={pane() === "pulse"} fallback={<StateLab />}>
              <PulseLab />
            </Show>
          }
        >
          <text fg={colors.faint}>TAB COMPARISON · P FOR PULSE LAB</text>
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
                    onSelect={setActive}
                  />
                </box>
              </box>
            )}
          </For>
        </Show>
      </box>

      <box height={3} flexShrink={0} backgroundColor={colors.surface} paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.text}>←/→ tab · 1–9 select · ↑/↓ variant · p pane · o overflow · q quit</text>
          <text fg={colors.accent}>tabs: {count()}</text>
        </box>
      </box>
    </box>
  )
}

function PulseLab() {
  return (
    <>
      <text fg={colors.faint}>PULSE LAB · P FOR TAB COMPARISON</text>
      <box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <For each={pulses}>
          {(pulse) => (
            <box width={45} height={1} flexDirection="row">
              <text width={10} fg={pulse.name === "Current" ? colors.accent : colors.subdued}>
                {pulse.name}
              </text>
              <box width={TAB_WIDTH} position="relative" backgroundColor={colors.surface}>
                <Show when={pulse.channel === "background"} fallback={<TextPulse duration={pulse.duration} />}>
                  <TabPulse
                    active
                    color={colors.accent}
                    backgroundColor={colors.surface}
                    duration={pulse.duration}
                    easing={pulse.easing}
                    head={pulse.head}
                    tail={pulse.tail}
                  />
                  <text zIndex={1} fg={colors.text}>
                    running session
                  </text>
                </Show>
              </box>
              <text width={13} fg={colors.faint}>
                {pulse.duration / 1_000}s {pulse.easing}
              </text>
            </box>
          )}
        </For>
      </box>
    </>
  )
}

function StateLab() {
  const states: Array<{ label: string; note: string; selected: boolean; tab: Sample }> = [
    {
      label: "Active",
      note: "surface + bright title + neutral-bright number",
      selected: true,
      tab: { sessionID: "active", title: "Selected session", state: "idle" },
    },
    {
      label: "Active run",
      note: "selection structure + neutral motion",
      selected: true,
      tab: { sessionID: "active-running", title: "Selected running", state: "running" },
    },
    {
      label: "Running",
      note: "neutral motion + idle number",
      selected: false,
      tab: { sessionID: "running", title: "Background task", state: "running" },
    },
    {
      label: "Unread",
      note: "accent number only",
      selected: false,
      tab: { sessionID: "unread", title: "New response", state: "unread" },
    },
    {
      label: "Attention",
      note: "warning-colored number",
      selected: false,
      tab: { sessionID: "attention", title: "Permission needed", state: "attention" },
    },
    {
      label: "Error",
      note: "error-colored number",
      selected: false,
      tab: { sessionID: "error", title: "Provider failed", state: "error" },
    },
    {
      label: "Idle",
      note: "subdued title + dim number",
      selected: false,
      tab: { sessionID: "idle", title: "Quiet session", state: "idle" },
    },
  ]

  return (
    <>
      <text fg={colors.faint}>STATE LAB · P FOR TAB COMPARISON</text>
      <box flexDirection="column">
        <For each={states}>
          {(item, index) => (
            <box height={1} flexDirection="row">
              <text width={14} fg={item.selected ? colors.accent : colors.subdued}>
                {item.label}
              </text>
              <Tab
                tab={item.tab}
                index={index()}
                leading
                width={TAB_WIDTH}
                variant="Rails"
                selected={item.selected}
                pulse
                onSelect={() => {}}
              />
              <text fg={colors.faint}>{item.note}</text>
            </box>
          )}
        </For>
      </box>
    </>
  )
}

function TextPulse(props: { duration: number }) {
  const label = "running session"
  const [clock, setClock] = createSignal(Date.now())
  const timer = setInterval(() => setClock(Date.now()), 40)
  onCleanup(() => clearInterval(timer))

  return (
    <box width={TAB_WIDTH} flexDirection="row">
      <For each={Array.from(label)}>
        {(character, index) => {
          const front = () => -4 + ((clock() % props.duration) / props.duration) * (label.length + 12)
          const intensity = () => Math.max(0, 1 - Math.abs(index() - front()) / 5)
          const foreground = () =>
            RGBA.fromValues(
              colors.text.r + (colors.faint.r - colors.text.r) * intensity(),
              colors.text.g + (colors.faint.g - colors.text.g) * intensity(),
              colors.text.b + (colors.faint.b - colors.text.b) * intensity(),
              1,
            )
          return <text fg={foreground()}>{character}</text>
        }}
      </For>
    </box>
  )
}

type TabStripProps = {
  variant: Variant
  active: number
  count: number
  width: number
  interactive?: boolean
  onSelect: (index: number) => void
}

function TabStrip(props: TabStripProps) {
  return (
    <box
      height={1}
      width="100%"
      position="relative"
      zIndex={props.interactive ? 1 : 0}
      renderAfter={function (buffer) {
        if (!props.interactive) return
        drawTabShadow(buffer, this.screenX, this.screenY + this.height, this.width, colors.background, 0.28)
      }}
    >
      <Show when={props.variant === "Adaptive"} fallback={<StandardTabStrip {...props} />}>
        <AdaptiveTabStrip {...props} />
      </Show>
    </box>
  )
}

function StandardTabStrip(props: TabStripProps) {
  const tabs = () => samples.slice(0, props.count)
  const gap = () => (props.variant === "Islands" ? 1 : 0)
  const tabWidth = createMemo(() => Math.max(10, Math.min(TAB_WIDTH, props.width - 8)))
  const visible = createMemo(() => {
    const unit = tabWidth() + gap()
    const full = Math.max(1, Math.floor((props.width + gap()) / unit))
    const remainder = props.width - full * tabWidth() - Math.max(0, full - 1) * gap()
    const start = Math.min(Math.max(0, props.active - Math.floor((full - 1) / 2)), Math.max(0, tabs().length - full))
    const count = full + Number(remainder > gap())
    return tabs().slice(start, start + count)
  })
  return (
    <box height={1} width="100%" position="relative" flexDirection="row" gap={gap()} overflow="hidden">
      <For each={visible()}>
        {(tab, visibleIndex) => (
          <Tab
            tab={tab}
            index={tabs().findIndex((item) => item.sessionID === tab.sessionID)}
            leading={visibleIndex() === 0}
            width={tabWidth()}
            variant={props.variant}
            selected={tabs()[props.active]?.sessionID === tab.sessionID}
            pulse={Boolean(props.interactive)}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </box>
  )
}

function AdaptiveTabStrip(props: TabStripProps) {
  const tabs = () => samples.slice(0, props.count)
  let windowStart = 0
  const visible = createMemo(() => {
    const count = Math.min(tabs().length, Math.max(1, 1 + Math.floor((props.width - TAB_WIDTH) / MIN_TAB_WIDTH)))
    if (props.active < windowStart) windowStart = props.active
    if (props.active >= windowStart + count) windowStart = props.active - count + 1
    windowStart = Math.min(Math.max(0, windowStart), Math.max(0, tabs().length - count))
    return tabs().slice(windowStart, windowStart + count)
  })
  const targets = createMemo(() => {
    const shown = visible()
    const total = props.width
    const activeID = tabs()[props.active]?.sessionID
    const inactiveWidth =
      shown.length === 1
        ? 0
        : Math.min(
            TAB_WIDTH,
            Math.max(MIN_TAB_WIDTH, Math.floor((total - Math.min(TAB_WIDTH, total)) / (shown.length - 1))),
          )
    const activeWidth = shown.length === 1 ? total : total - inactiveWidth * (shown.length - 1)
    return {
      total,
      values: new Map(shown.map((tab) => [tab.sessionID, tab.sessionID === activeID ? activeWidth : inactiveWidth])),
    }
  })
  const state = new Map<string, { width: number; velocity: number; selection: number; selectionVelocity: number }>()
  const [frame, setFrame] = createSignal(0)
  let signature = ""
  let total = 0

  createEffect(() => {
    const next = targets()
    const nextSignature = [...next.values.keys()].join(":")
    const reset = (signature && signature !== nextSignature) || (total && total !== next.total)
    signature = nextSignature
    total = next.total
    for (const [sessionID, width] of next.values) {
      const selection = Number(sessionID === tabs()[props.active]?.sessionID)
      if (reset) state.set(sessionID, { width, velocity: 0, selection, selectionVelocity: 0 })
      if (!state.has(sessionID)) state.set(sessionID, { width, velocity: 0, selection, selectionVelocity: 0 })
    }
    if (reset) setFrame((value) => value + 1)
  })

  let previous = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    const delta = Math.min(0.05, (now - previous) / 1_000)
    previous = now
    const frequency = (2 * Math.PI) / (ADAPTIVE_SPRING.visualDuration * 1.2)

    for (const [sessionID, target] of targets().values) {
      const selectionTarget = Number(sessionID === tabs()[props.active]?.sessionID)
      const current = state.get(sessionID) ?? {
        width: target,
        velocity: 0,
        selection: selectionTarget,
        selectionVelocity: 0,
      }
      const offset = current.width - target
      const decay = Math.exp(-frequency * delta)
      const velocity = current.velocity + frequency * offset
      current.width = target + (offset + velocity * delta) * decay
      current.velocity = (current.velocity - frequency * velocity * delta) * decay
      const selectionOffset = current.selection - selectionTarget
      const selectionVelocity = current.selectionVelocity + frequency * selectionOffset
      current.selection = selectionTarget + (selectionOffset + selectionVelocity * delta) * decay
      current.selectionVelocity = (current.selectionVelocity - frequency * selectionVelocity * delta) * decay
      state.set(sessionID, current)
    }
    setFrame((value) => value + 1)
  }, 16)
  onCleanup(() => clearInterval(timer))

  const widths = createMemo(() => {
    frame()
    const current = visible().map((tab) => Math.max(1, Math.round(state.get(tab.sessionID)?.width ?? 1)))
    const active = visible().findIndex((tab) => tab.sessionID === tabs()[props.active]?.sessionID)
    if (active !== -1) current[active]! += targets().total - current.reduce((sum, width) => sum + width, 0)
    return current
  })
  const selections = createMemo(() => {
    frame()
    return new Map(visible().map((tab) => [tab.sessionID, state.get(tab.sessionID)?.selection ?? 0]))
  })

  return (
    <box height={1} width="100%" flexDirection="row" overflow="hidden">
      <For each={visible()}>
        {(tab, visibleIndex) => (
          <Tab
            tab={tab}
            index={tabs().findIndex((item) => item.sessionID === tab.sessionID)}
            leading={visibleIndex() === 0}
            width={widths()[visibleIndex()]!}
            variant="Adaptive"
            selected={tabs()[props.active]?.sessionID === tab.sessionID}
            selection={selections().get(tab.sessionID) ?? 0}
            pulse={Boolean(props.interactive)}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </box>
  )
}

function Tab(props: {
  tab: Sample
  index: number
  leading: boolean
  width: number
  variant: Variant
  selected: boolean
  selection?: number
  pulse: boolean
  onSelect: (index: number) => void
}) {
  const [hovered, setHovered] = createSignal(false)
  const selection = () => props.selection ?? Number(props.selected)
  const status = () => {
    if (props.tab.state === "attention") return colors.warning
    if (props.tab.state === "error") return colors.error
    if (props.tab.state === "unread") return colors.accent
    if (props.selected) return blend(colors.subdued, colors.text, 0.65)
    return blend(colors.subdued, colors.background, 0.35)
  }
  const background = () => {
    if (props.variant === "Islands") return blend(colors.surface, colors.surfaceHigh, selection())
    if (props.variant === "Adaptive") return blend(colors.background, colors.surfaceHigh, selection())
    return blend(colors.background, colors.surface, selection())
  }
  const edge = () => {
    if (props.leading && (props.variant === "Rails" || props.variant === "Adaptive")) return " "
    if (props.variant === "Rails" || props.variant === "Adaptive") return "▏"
    return " "
  }
  const foreground = () => blend(colors.subdued, colors.text, selection())
  const pulseBackground = () => background() ?? colors.background
  const hasRail = () => !props.leading && (props.variant === "Rails" || props.variant === "Adaptive")
  const titleWidth = () => Math.max(2, props.width - 3)
  const visibleTitle = () => props.tab.title.slice(0, titleWidth())
  const titleFades = () => props.tab.title.length > titleWidth() && titleWidth() > 4
  const numberColor = () => {
    return status()
  }

  return (
    <box
      width={props.width}
      height={1}
      position="relative"
      flexDirection="row"
      backgroundColor={background()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => props.onSelect(props.index)}
    >
      <Show when={props.pulse && props.tab.state === "running"}>
        <TabPulse active color={blend(pulseBackground(), colors.text, 0.45)} backgroundColor={pulseBackground()} wrap />
      </Show>
      <box zIndex={1} width="100%" flexDirection="row">
        <text width={1} fg={colors.faint}>
          {hasRail() ? edge() : " "}
        </text>
        <text width={2} fg={numberColor()}>
          {props.index + 1}
        </text>
        <Show
          when={titleFades()}
          fallback={
            <text width={titleWidth()} fg={foreground()} wrapMode="none">
              {visibleTitle()}
            </text>
          }
        >
          <text width={titleWidth()} fg={foreground()} wrapMode="none">
            {visibleTitle().slice(0, -4)}
            <span style={{ fg: blend(foreground(), pulseBackground(), 0.2) }}>{visibleTitle().slice(-4, -3)}</span>
            <span style={{ fg: blend(foreground(), pulseBackground(), 0.45) }}>{visibleTitle().slice(-3, -2)}</span>
            <span style={{ fg: blend(foreground(), pulseBackground(), 0.7) }}>{visibleTitle().slice(-2, -1)}</span>
            <span style={{ fg: blend(foreground(), pulseBackground(), 0.92) }}>{visibleTitle().slice(-1)}</span>
          </text>
        </Show>
        <text
          position="absolute"
          right={0}
          zIndex={2}
          width={1}
          fg={foreground()}
          onMouseUp={(event) => {
            event.stopPropagation()
          }}
        >
          {hovered() ? "×" : ""}
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
