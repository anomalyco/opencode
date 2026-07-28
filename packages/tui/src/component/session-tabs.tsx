import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { adaptiveSessionTabLayout, sessionTabComplete, SESSION_TAB_OVERFLOW_WIDTH } from "../context/session-tabs-model"
import { TabPulse } from "./tab-pulse"
import { drawTabShadow } from "./tab-shadow"
import { tint } from "../theme/color"

const ADAPTIVE_SPRING_FREQUENCY = (2 * Math.PI) / (0.1 * 1.2)
const NEW_SESSION_TAB_ID = "$new"
const spring = (value: number, velocity: number, target: number, frequency: number, delta: number) => {
  const offset = value - target
  const decay = Math.exp(-frequency * delta)
  const nextVelocity = velocity + frequency * offset
  return {
    value: target + (offset + nextVelocity * delta) * decay,
    velocity: (velocity - frequency * nextVelocity * delta) * decay,
  }
}
const initialState = (width: number, selection: number, activity: number) => ({
  width,
  velocity: 0,
  selection,
  selectionVelocity: 0,
  activity,
  activityVelocity: 0,
})

export function SessionTabs() {
  const tabs = useSessionTabs()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const { themeV2, mode } = useTheme()
  const config = useConfig().data
  const [hovered, setHovered] = createSignal<string>()
  const hueStep = () => (mode() === "light" ? 800 : 200)
  const accent = () => themeV2.hue.accent[hueStep()]
  const activeNumber = () => tint(themeV2.hue.interactive[hueStep()], themeV2.background.default, 0.25)
  const idleNumber = () => tint(themeV2.text.subdued, themeV2.background.default, 0.35)
  const activeID = () => (route.data.type === "home" ? NEW_SESSION_TAB_ID : tabs.current())
  const items = createMemo(() =>
    route.data.type === "home"
      ? [...tabs.tabs(), { sessionID: NEW_SESSION_TAB_ID, title: "New session" }]
      : tabs.tabs(),
  )
  const isNew = (sessionID: string) => sessionID === NEW_SESSION_TAB_ID
  const unread = (sessionID: string) => (isNew(sessionID) ? undefined : tabs.unread(sessionID))
  const busy = (sessionID: string) => !isNew(sessionID) && tabs.busy(sessionID)
  const complete = (sessionID: string) => sessionTabComplete(unread(sessionID), busy(sessionID))
  let windowStart = 0
  const layout = createMemo(() => {
    const next = adaptiveSessionTabLayout(items(), activeID(), dimensions().width, windowStart)
    windowStart = next.start
    return next
  })
  const targets = createMemo(() => new Map(layout().tabs.map((tab, index) => [tab.sessionID, layout().widths[index]!])))
  const state = new Map<string, ReturnType<typeof initialState>>()
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
      const selection = Number(sessionID === activeID())
      const activityTarget = Number(complete(sessionID))
      if (reset) state.set(sessionID, initialState(width, selection, activityTarget))
      if (!state.has(sessionID)) state.set(sessionID, initialState(width, selection, activityTarget))
    }
    for (const sessionID of state.keys()) if (!next.has(sessionID)) state.delete(sessionID)
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
    previous = now
    let moving = false

    for (const [sessionID, target] of targets()) {
      const selectionTarget = Number(sessionID === activeID())
      const activityTarget = Number(complete(sessionID))
      const current = state.get(sessionID) ?? initialState(target, selectionTarget, activityTarget)
      const width = spring(current.width, current.velocity, target, ADAPTIVE_SPRING_FREQUENCY, delta)
      current.width = width.value
      current.velocity = width.velocity
      const selection = spring(
        current.selection,
        current.selectionVelocity,
        selectionTarget,
        ADAPTIVE_SPRING_FREQUENCY,
        delta,
      )
      current.selection = selection.value
      current.selectionVelocity = selection.velocity
      const activity = spring(
        current.activity,
        current.activityVelocity,
        activityTarget,
        ADAPTIVE_SPRING_FREQUENCY,
        delta,
      )
      current.activity = activity.value
      current.activityVelocity = activity.velocity
      moving ||=
        Math.abs(current.width - target) > 0.002 ||
        Math.abs(current.velocity) > 0.002 ||
        Math.abs(current.selection - selectionTarget) > 0.002 ||
        Math.abs(current.selectionVelocity) > 0.002 ||
        Math.abs(current.activity - activityTarget) > 0.002 ||
        Math.abs(current.activityVelocity) > 0.002
      state.set(sessionID, current)
    }
    setFrame((value) => value + 1)
    if (!moving) stop()
  }
  onCleanup(stop)

  const visuals = createMemo(() => {
    frame()
    const widths = layout().tabs.map((tab) =>
      Math.max(1, Math.round(state.get(tab.sessionID)?.width ?? targets().get(tab.sessionID)!)),
    )
    const active = layout().tabs.findIndex((tab) => tab.sessionID === activeID())
    if (active !== -1) widths[active]! += layout().total - widths.reduce((sum, width) => sum + width, 0)
    return new Map(
      layout().tabs.map((tab, index) => [
        tab.sessionID,
        {
          width: widths[index]!,
          selection: state.get(tab.sessionID)?.selection ?? Number(tab.sessionID === activeID()),
          activity: state.get(tab.sessionID)?.activity ?? Number(complete(tab.sessionID)),
        },
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
        <text width={SESSION_TAB_OVERFLOW_WIDTH} fg={themeV2.text.subdued}>
          ‹{layout().before}
        </text>
      </Show>
      <For each={layout().tabs}>
        {(tab) => {
          const selected = () => activeID() === tab.sessionID
          const tabUnread = () => unread(tab.sessionID)
          const tabBusy = () => busy(tab.sessionID)
          const tabComplete = () => complete(tab.sessionID)
          const width = () => visuals().get(tab.sessionID)?.width ?? targets().get(tab.sessionID)!
          const selection = () => visuals().get(tab.sessionID)?.selection ?? Number(selected())
          const activity = () => visuals().get(tab.sessionID)?.activity ?? Number(tabComplete())
          const background = () => {
            const base =
              hovered() === tab.sessionID && !selected()
                ? themeV2.background.action.primary.hovered
                : themeV2.background.default
            return tint(base, themeV2.raise(themeV2.background.surface.offset), selection())
          }
          const pulseBackground = () => background()
          const pulseColor = () => tint(pulseBackground(), themeV2.text.default, 0.45)
          const title = () => tab.title ?? "Untitled session"
          const availableTitleWidth = () => Math.max(1, width() - 3)
          const visibleTitle = () => title().slice(0, availableTitleWidth())
          const titleFades = () => title().length > availableTitleWidth() && availableTitleWidth() > 4
          const foreground = () => {
            if (hovered() === tab.sessionID) return themeV2.text.default
            return tint(themeV2.text.subdued, themeV2.text.default, selection())
          }
          const numberColor = () => {
            if (!isNew(tab.sessionID) && tabs.attention(tab.sessionID)) return themeV2.text.feedback.warning.default
            if (tabUnread() === "error") return themeV2.text.feedback.error.default
            const base =
              hovered() === tab.sessionID && !selected()
                ? foreground()
                : tint(idleNumber(), activeNumber(), selection())
            return tint(base, accent(), activity())
          }
          return (
            <box
              width={width()}
              position="relative"
              flexDirection="row"
              backgroundColor={background()}
              onMouseOver={() => setHovered(tab.sessionID)}
              onMouseOut={() => setHovered(undefined)}
              onMouseUp={() => {
                if (isNew(tab.sessionID)) return route.navigate({ type: "home" })
                tabs.select(tab.sessionID)
              }}
            >
              <TabPulse
                enabled={config.animations ?? true}
                active={tabBusy()}
                complete={tabComplete()}
                color={pulseColor()}
                completionColor={accent()}
                backgroundColor={pulseBackground()}
              />
              <box zIndex={1} width="100%" flexDirection="row">
                <text width={1}> </text>
                <text width={2} fg={numberColor()}>
                  {items().findIndex((item) => item.sessionID === tab.sessionID) + 1}
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
                    <span style={{ fg: tint(foreground(), pulseBackground(), 0.2) }}>
                      {visibleTitle().slice(-4, -3)}
                    </span>
                    <span style={{ fg: tint(foreground(), pulseBackground(), 0.45) }}>
                      {visibleTitle().slice(-3, -2)}
                    </span>
                    <span style={{ fg: tint(foreground(), pulseBackground(), 0.7) }}>
                      {visibleTitle().slice(-2, -1)}
                    </span>
                    <span style={{ fg: tint(foreground(), pulseBackground(), 0.92) }}>{visibleTitle().slice(-1)}</span>
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
                    if (!isNew(tab.sessionID)) return tabs.close(tab.sessionID)
                    tabs.close()
                  }}
                >
                  {hovered() === tab.sessionID && (!isNew(tab.sessionID) || tabs.tabs().length > 0) ? "×" : ""}
                </text>
              </box>
            </box>
          )
        }}
      </For>
      <Show when={layout().after > 0}>
        <text width={SESSION_TAB_OVERFLOW_WIDTH} fg={themeV2.text.subdued}>
          {layout().after}›
        </text>
      </Show>
    </box>
  )
}
