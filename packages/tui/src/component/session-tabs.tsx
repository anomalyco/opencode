import { RGBA, TextAttributes } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme, useThemes } from "../context/theme"
import {
  adaptiveSessionTabLayout,
  sessionTabComplete,
  SESSION_TAB_OVERFLOW_WIDTH,
  type SessionTabUnread,
} from "../context/session-tabs-model"
import { createAnimatable, spring } from "../ui/animation"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { TabPulse } from "./tab-pulse"
import { tint } from "../theme/color"

type ContextController = ReturnType<typeof useSessionTabs>
export type SessionTabsStatus = Omit<ReturnType<ContextController["status"]>, "unread"> & {
  unread: SessionTabUnread | undefined
}
export type SessionTabsController = Pick<ContextController, "tabs" | "current" | "select" | "close"> & {
  status(sessionID: string): SessionTabsStatus
}

export function SessionTabs(props: { controller?: SessionTabsController; animations?: boolean } = {}) {
  const tabs = props.controller ?? useSessionTabs()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const { mode } = useThemes()
  const config = useConfig().data
  const animations = () => props.animations ?? config.animations ?? true
  const [hovered, setHovered] = createSignal<string>()
  const hueStep = () => (mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const activeNumber = () => tint(theme.hue.interactive[hueStep()], theme.background.default, 0.25)
  const idleNumber = () => tint(theme.text.subdued, theme.background.default, 0.35)
  const activeID = createMemo(tabs.current)
  const items = tabs.tabs
  const layout = createMemo((previous: ReturnType<typeof adaptiveSessionTabLayout> | undefined) =>
    adaptiveSessionTabLayout(items(), activeID(), dimensions().width, previous?.start),
  )
  const statuses = createMemo(
    () =>
      new Map(
        layout().tabs.map((tab) => {
          const status = tabs.status(tab.sessionID)
          return [
            tab.sessionID,
            {
              ...status,
              complete: sessionTabComplete(status.unread, status.busy),
            },
          ] as const
        }),
      ),
  )
  const targets = createMemo(() => ({
    widths: layout().widths,
    selections: layout().tabs.map((tab) => Number(tab.sessionID === activeID())),
    activities: layout().tabs.map((tab) => Number(statuses().get(tab.sessionID)!.complete)),
  }))
  const motion = createAnimatable(targets(), {
    enabled: animations,
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
          activity: current.activities[index] ?? Number(statuses().get(tab.sessionID)!.complete),
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
            theme.background.default.r,
            theme.background.default.g,
            theme.background.default.b,
            mode() === "light" ? 0.14 : 0.28,
          ),
        )
      }}
    >
      <Show when={layout().before > 0}>
        <text width={SESSION_TAB_OVERFLOW_WIDTH} fg={theme.text.subdued}>
          ‹{layout().before}
        </text>
      </Show>
      <For each={layout().tabs}>
        {(tab) => {
          const selected = () => activeID() === tab.sessionID
          const status = () => statuses().get(tab.sessionID)!
          const width = () => visuals().get(tab.sessionID)?.width ?? 1
          const selection = () => visuals().get(tab.sessionID)?.selection ?? Number(selected())
          const activity = () => visuals().get(tab.sessionID)?.activity ?? Number(status().complete)
          const background = () => {
            const base =
              hovered() === tab.sessionID && !selected()
                ? theme.background.action.primary.hovered
                : theme.background.default
            return tint(base, theme.raise(theme.background.surface.offset), selection())
          }
          const pulseBackground = () => background()
          const pulseColor = () => tint(pulseBackground(), theme.text.default, 0.45)
          const title = () => tab.title ?? "Untitled session"
          const availableTitleWidth = () => Math.max(1, width() - 3)
          const visibleTitle = createMemo(() => Locale.takeWidth(title(), availableTitleWidth()))
          const visibleTitleParts = createMemo(() => Locale.graphemes(visibleTitle()))
          const fadeWidth = () => (hovered() === tab.sessionID ? 6 : 4)
          const fadedTitleParts = createMemo(() => visibleTitleParts().slice(-fadeWidth()))
          const titleFades = createMemo(
            () => stringWidth(title()) >= availableTitleWidth() && availableTitleWidth() > fadeWidth(),
          )
          const foreground = () => {
            if (hovered() === tab.sessionID) return theme.text.default
            return tint(theme.text.subdued, theme.text.default, selection())
          }
          const numberColor = () => {
            if (status().attention) return theme.text.feedback.warning.default
            if (status().unread === "error") return theme.text.feedback.error.default
            const base =
              hovered() === tab.sessionID && !selected()
                ? foreground()
                : tint(idleNumber(), activeNumber(), selection())
            return tint(base, accent(), activity())
          }
          const closeColor = () => tint(theme.text.subdued, theme.text.default, 0.6)
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
                enabled={animations()}
                active={status().busy}
                complete={status().complete}
                glow={status().unread === "activity" && !status().busy && !selected() && !status().attention}
                color={pulseColor()}
                glowColor={accent()}
                completionColor={accent()}
                backgroundColor={pulseBackground()}
              />
              <box zIndex={1} width="100%" flexDirection="row">
                <text width={1}> </text>
                <text width={2} fg={numberColor()} attributes={selected() ? TextAttributes.BOLD : undefined}>
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
                    {visibleTitleParts().slice(0, -fadeWidth()).join("")}
                    <For each={fadedTitleParts()}>
                      {(character, index) => (
                        <span
                          style={{
                            fg: tint(
                              foreground(),
                              pulseBackground(),
                              0.2 + 0.72 * (index() / Math.max(1, fadedTitleParts().length - 1)),
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
        <text width={SESSION_TAB_OVERFLOW_WIDTH} fg={theme.text.subdued}>
          {layout().after}›
        </text>
      </Show>
    </box>
  )
}
