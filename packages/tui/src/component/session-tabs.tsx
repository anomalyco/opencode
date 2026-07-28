import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { adaptiveSessionTabLayout } from "../context/session-tabs-model"
import { TabPulse } from "./tab-pulse"
import { drawTabShadow } from "./tab-shadow"

const TAB_WIDTH = 22
const MIN_TAB_WIDTH = 8
const OVERFLOW_WIDTH = 3
const ADAPTIVE_SPRING = { visualDuration: 0.1, bounce: 0 } as const
const blend = (from: RGBA, to: RGBA, amount: number) =>
  RGBA.fromValues(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
    from.a + (to.a - from.a) * amount,
  )

export function SessionTabs() {
  const tabs = useSessionTabs()
  const dimensions = useTerminalDimensions()
  const { themeV2, mode } = useTheme()
  const config = useConfig().data
  const [hovered, setHovered] = createSignal<string>()
  const accent = () => themeV2.hue.accent[mode() === "light" ? 800 : 200]
  const idleRail = () => blend(themeV2.border.default, themeV2.background.default, 0.6)
  const idleNumber = () => blend(themeV2.text.subdued, themeV2.background.default, 0.35)
  let windowStart = 0
  const layout = createMemo(() => {
    const next = adaptiveSessionTabLayout(tabs.tabs(), tabs.current(), dimensions().width, windowStart, {
      preferredWidth: TAB_WIDTH,
      minimumWidth: MIN_TAB_WIDTH,
      overflowWidth: OVERFLOW_WIDTH,
    })
    windowStart = next.start
    return next
  })
  const targets = createMemo(() => new Map(layout().tabs.map((tab, index) => [tab.sessionID, layout().widths[index]!])))
  const state = new Map<string, { width: number; velocity: number; selection: number; selectionVelocity: number }>()
  const [frame, setFrame] = createSignal(0)
  let signature = ""
  let total = 0

  createEffect(() => {
    const next = targets()
    const nextSignature = [...next.keys()].join(":")
    const reset =
      (signature && signature !== nextSignature) || (total && total !== layout().total) || !(config.animations ?? true)
    signature = nextSignature
    total = layout().total
    for (const [sessionID, width] of next) {
      const selection = Number(sessionID === tabs.current())
      if (reset) state.set(sessionID, { width, velocity: 0, selection, selectionVelocity: 0 })
      if (!state.has(sessionID)) state.set(sessionID, { width, velocity: 0, selection, selectionVelocity: 0 })
    }
    if (reset) setFrame((value) => value + 1)
    start()
  })

  let previous = performance.now()
  let timer: ReturnType<typeof setInterval> | undefined
  function start() {
    if (timer || !(config.animations ?? true)) return
    previous = performance.now()
    timer = setInterval(tick, 16)
  }
  function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }
  function tick() {
    if (!(config.animations ?? true)) return stop()
    const now = performance.now()
    const delta = Math.min(0.05, (now - previous) / 1_000)
    const frequency = (2 * Math.PI) / (ADAPTIVE_SPRING.visualDuration * 1.2)
    previous = now
    let moving = false

    for (const [sessionID, target] of targets()) {
      const selectionTarget = Number(sessionID === tabs.current())
      const current = state.get(sessionID) ?? {
        width: target,
        velocity: 0,
        selection: selectionTarget,
        selectionVelocity: 0,
      }
      const decay = Math.exp(-frequency * delta)
      const offset = current.width - target
      const velocity = current.velocity + frequency * offset
      current.width = target + (offset + velocity * delta) * decay
      current.velocity = (current.velocity - frequency * velocity * delta) * decay
      const selectionOffset = current.selection - selectionTarget
      const selectionVelocity = current.selectionVelocity + frequency * selectionOffset
      current.selection = selectionTarget + (selectionOffset + selectionVelocity * delta) * decay
      current.selectionVelocity = (current.selectionVelocity - frequency * selectionVelocity * delta) * decay
      moving ||=
        Math.abs(current.width - target) > 0.002 ||
        Math.abs(current.velocity) > 0.002 ||
        Math.abs(current.selection - selectionTarget) > 0.002 ||
        Math.abs(current.selectionVelocity) > 0.002
      state.set(sessionID, current)
    }
    setFrame((value) => value + 1)
    if (!moving) stop()
  }
  onCleanup(stop)

  const widths = createMemo(() => {
    frame()
    const current = layout().tabs.map((tab) =>
      Math.max(1, Math.round(state.get(tab.sessionID)?.width ?? targets().get(tab.sessionID)!)),
    )
    const active = layout().tabs.findIndex((tab) => tab.sessionID === tabs.current())
    if (active !== -1) current[active]! += layout().total - current.reduce((sum, width) => sum + width, 0)
    return new Map(layout().tabs.map((tab, index) => [tab.sessionID, current[index]!]))
  })
  const selections = createMemo(() => {
    frame()
    return new Map(
      layout().tabs.map((tab) => [
        tab.sessionID,
        state.get(tab.sessionID)?.selection ?? Number(tab.sessionID === tabs.current()),
      ]),
    )
  })

  return (
    <box
      height={1}
      flexShrink={0}
      position="relative"
      flexDirection="row"
      zIndex={1}
      renderAfter={function (buffer) {
        drawTabShadow(
          buffer,
          this.screenX,
          this.screenY + this.height,
          this.width,
          themeV2.background.default,
          mode() === "light" ? 0.14 : 0.28,
        )
      }}
    >
      <Show when={layout().before > 0}>
        <text width={OVERFLOW_WIDTH} fg={themeV2.text.subdued}>
          ‹{layout().before}
        </text>
      </Show>
      <For each={layout().tabs}>
        {(tab, index) => {
          const selected = () => tabs.current() === tab.sessionID
          const unread = () => tabs.unread(tab.sessionID)
          const width = () => widths().get(tab.sessionID) ?? targets().get(tab.sessionID)!
          const selection = () => selections().get(tab.sessionID) ?? Number(selected())
          const background = () => {
            const base =
              hovered() === tab.sessionID && !selected()
                ? themeV2.background.action.primary.hovered
                : themeV2.background.default
            return blend(base, themeV2.raise(themeV2.background.surface.offset), selection())
          }
          const pulseBackground = () => background()
          const pulseColor = () => blend(pulseBackground(), themeV2.text.default, 0.45)
          const title = () => tab.title ?? "Untitled session"
          const availableTitleWidth = () => Math.max(1, width() - 3)
          const visibleTitle = () => title().slice(0, availableTitleWidth())
          const titleFades = () => title().length > availableTitleWidth() && availableTitleWidth() > 4
          const foreground = () => {
            if (hovered() === tab.sessionID) return themeV2.text.default
            return blend(themeV2.text.subdued, themeV2.text.default, selection())
          }
          const numberColor = () => {
            if (tabs.attention(tab.sessionID)) return themeV2.text.feedback.warning.default
            if (unread() === "error") return themeV2.text.feedback.error.default
            if (unread() === "activity") return accent()
            if (selected()) return blend(themeV2.text.subdued, themeV2.text.default, 0.65)
            if (hovered() === tab.sessionID) return foreground()
            return idleNumber()
          }
          return (
            <box
              width={width()}
              position="relative"
              flexDirection="row"
              backgroundColor={background()}
              onMouseOver={() => setHovered(tab.sessionID)}
              onMouseOut={() => setHovered(undefined)}
              onMouseUp={() => tabs.select(tab.sessionID)}
            >
              <TabPulse
                active={tabs.running(tab.sessionID) && (config.animations ?? true)}
                color={pulseColor()}
                backgroundColor={pulseBackground()}
                wrap
              />
              <box zIndex={1} width="100%" flexDirection="row">
                <text width={1} fg={idleRail()}>
                  {index() === 0 ? " " : "▏"}
                </text>
                <text width={2} fg={numberColor()}>
                  {tabs.tabs().findIndex((item) => item.sessionID === tab.sessionID) + 1}
                </text>
                <Show
                  when={titleFades()}
                  fallback={
                    <text width={availableTitleWidth()} fg={foreground()} wrapMode="none">
                      {visibleTitle()}
                    </text>
                  }
                >
                  <text width={availableTitleWidth()} fg={foreground()} wrapMode="none">
                    {visibleTitle().slice(0, -4)}
                    <span style={{ fg: blend(foreground(), pulseBackground(), 0.2) }}>
                      {visibleTitle().slice(-4, -3)}
                    </span>
                    <span style={{ fg: blend(foreground(), pulseBackground(), 0.45) }}>
                      {visibleTitle().slice(-3, -2)}
                    </span>
                    <span style={{ fg: blend(foreground(), pulseBackground(), 0.7) }}>
                      {visibleTitle().slice(-2, -1)}
                    </span>
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
                    tabs.close(tab.sessionID)
                  }}
                >
                  {hovered() === tab.sessionID ? "×" : ""}
                </text>
              </box>
            </box>
          )
        }}
      </For>
      <Show when={layout().after > 0}>
        <text width={OVERFLOW_WIDTH} fg={themeV2.text.subdued}>
          {layout().after}›
        </text>
      </Show>
    </box>
  )
}
