import { RGBA } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { adaptiveSessionTabLayout, sessionTabComplete, SESSION_TAB_OVERFLOW_WIDTH } from "../context/session-tabs-model"
import { createAnimatable, spring } from "../ui/animation"
import { TabPulse } from "./tab-pulse"
import { tint } from "../theme/color"

const NEW_SESSION_TAB_ID = "$new"

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
  const targets = createMemo(() => ({
    widths: layout().widths,
    selections: layout().tabs.map((tab) => Number(tab.sessionID === activeID())),
    activities: layout().tabs.map((tab) => Number(complete(tab.sessionID))),
  }))
  const motion = createAnimatable(targets(), {
    enabled: () => config.animations ?? true,
    transition: spring({ visualDuration: 0.1 }),
  })
  const identity = createMemo(() =>
    layout()
      .tabs.map((tab) => tab.sessionID)
      .join(":"),
  )
  let signature = ""
  let total = 0

  createEffect(() => {
    const next = targets()
    const nextSignature = identity()
    const reset = (signature && signature !== nextSignature) || (total && total !== layout().total)
    signature = nextSignature
    total = layout().total
    if (reset) return motion.jump(next)
    motion.animate(next)
  })

  const visuals = createMemo(() => {
    const current = signature === identity() && total === layout().total ? motion.value() : targets()
    const widths = current.widths.map((width) => Math.max(1, Math.round(width)))
    const active = layout().tabs.findIndex((tab) => tab.sessionID === activeID())
    if (active !== -1) widths[active]! += layout().total - widths.reduce((sum, width) => sum + width, 0)
    return new Map(
      layout().tabs.map((tab, index) => [
        tab.sessionID,
        {
          width: widths[index]!,
          selection: current.selections[index] ?? Number(tab.sessionID === activeID()),
          activity: current.activities[index] ?? Number(complete(tab.sessionID)),
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
        const x = Math.max(0, this.screenX)
        const y = this.screenY + this.height
        const width = Math.min(this.width, buffer.width - x)
        if (y < 0 || y >= buffer.height || width <= 0) return
        buffer.fillRect(
          x,
          y,
          width,
          1,
          RGBA.fromValues(
            themeV2.background.default.r,
            themeV2.background.default.g,
            themeV2.background.default.b,
            mode() === "light" ? 0.14 : 0.28,
          ),
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
          const width = () => visuals().get(tab.sessionID)?.width ?? 1
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
          const fadeWidth = () => (hovered() === tab.sessionID ? 6 : 4)
          const titleFades = () => title().length > availableTitleWidth() && availableTitleWidth() > fadeWidth()
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
          const closeColor = () => tint(themeV2.text.subdued, themeV2.text.default, 0.6)
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
                    {visibleTitle().slice(0, -fadeWidth())}
                    <For each={visibleTitle().slice(-fadeWidth()).split("")}>
                      {(character, index) => (
                        <span
                          style={{
                            fg: tint(
                              foreground(),
                              pulseBackground(),
                              0.2 + 0.72 * (index() / Math.max(1, fadeWidth() - 1)),
                            ),
                          }}
                        >
                          {character}
                        </span>
                      )}
                    </For>
                  </text>
                </Show>
                <text
                  position="absolute"
                  right={1}
                  zIndex={2}
                  width={1}
                  fg={closeColor()}
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
