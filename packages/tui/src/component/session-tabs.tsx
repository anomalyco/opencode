import { RGBA, TextAttributes } from "@opentui/core"
import { For, Show, createComputed, createEffect, createMemo, createSignal, untrack } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme, useThemes } from "../context/theme"
import {
  adaptiveSessionTabLayout,
  sessionTabComplete,
  seedSessionTabMotion,
  sessionTabOverflowWidth,
  type SessionTabUnread,
} from "../context/session-tabs-model"
import { createAnimatable, spring, tween } from "../ui/animation"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { TabPulse } from "./tab-pulse"
import { tint } from "../theme/color"

type ContextController = ReturnType<typeof useSessionTabs>
export type SessionTabsStatus = Omit<ReturnType<ContextController["status"]>, "unread"> & {
  unread: SessionTabUnread | undefined
}
export type SessionTabsController = Pick<ContextController, "tabs" | "current" | "select" | "close" | "move"> & {
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
  const [dragging, setDragging] = createSignal<string>()
  let strip: { screenX: number } | undefined
  const hueStep = () => (mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const activeNumber = () => theme.hue.interactive[hueStep()]
  const idleNumber = () => tint(theme.text.subdued, theme.background.default, 0.35)
  const activeID = createMemo(tabs.current)
  const items = () => tabs.tabs()
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

  // createComputed runs before render effects, so seeded widths are visible on the first frame
  // of a membership change instead of flashing the final layout.
  createComputed(() => {
    const next = targets()
    const nextSignature = identity()
    const changed = Boolean(signature) && signature !== nextSignature
    const resized = Boolean(total) && total !== layout().total
    const previous = signature ? signature.split(":") : []
    signature = nextSignature
    total = layout().total
    if (!changed && !resized) return motion.animate(next)
    // Identity-stable total changes are terminal resizes and still jump.
    if (!changed) return motion.jump(next)
    const seeded = seedSessionTabMotion(
      previous,
      layout().tabs.map((tab) => tab.sessionID),
      untrack(motion.value),
      next,
    )
    if (!seeded) return motion.jump(next)
    motion.jump(seeded)
    motion.animate(next)
  })

  const visuals = createMemo(() => {
    const current = signature === identity() && total === layout().total ? motion.value() : targets()
    const widths = current.widths.map((width) => Math.max(1, Math.round(width)))
    const active = layout().tabs.findIndex((tab) => tab.sessionID === activeID())
    const remainder = layout().total - widths.reduce((sum, width) => sum + width, 0)
    // Absorb only rounding slack; membership animations leave a real gap while widths grow into place.
    if (active !== -1 && Math.abs(remainder) <= layout().tabs.length) widths[active]! += remainder
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

  // Map an absolute pointer column to the items index of the visible slot beneath it.
  const slotAt = (x: number) => {
    if (!strip) return undefined
    const stripX = x - strip.screenX
    let edge = layout().before > 0 ? sessionTabOverflowWidth(layout().before) : 0
    for (const [index, width] of layout().widths.entries()) {
      edge += width
      if (stripX < edge) return layout().before + index
    }
    return layout().before + layout().widths.length - 1
  }

  return (
    <box
      ref={(element) => (strip = element)}
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
        <text width={sessionTabOverflowWidth(layout().before)} fg={theme.text.subdued} selectable={false}>
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
          const dragged = () => dragging() === tab.sessionID
          const background = () => {
            const lifted = (hovered() === tab.sessionID || dragged()) && !selected()
            const base = lifted ? theme.background.action.primary.hovered : theme.background.default
            // A dragged tab lifts to full selected elevation while it is held.
            return tint(base, theme.raise(theme.background.surface.offset), dragged() ? 1 : selection())
          }
          const pulseBackground = () => background()
          const pulseColor = () => tint(pulseBackground(), theme.text.default, 0.45)
          const glowColor = () => {
            if (status().attention) return theme.text.feedback.warning.default
            if (status().unread === "error") return theme.text.feedback.error.default
            return accent()
          }
          const glows = () => !selected() && (status().attention || (!status().busy && status().unread !== undefined))
          const title = () => tab.title ?? "Untitled session"
          let currentTitle = title()
          const [outgoingTitle, setOutgoingTitle] = createSignal<string>()
          const wipe = createAnimatable({ front: 1 }, { enabled: animations, transition: tween({ duration: 0.3 }) })
          createEffect(() => {
            const next = title()
            if (next === currentTitle) return
            setOutgoingTitle(currentTitle)
            currentTitle = next
            wipe.jump({ front: 0 })
            wipe.animate({ front: 1 })
          })
          const tabNumber = () => items().findIndex((item) => item.sessionID === tab.sessionID) + 1
          // The number cell keeps one trailing space, even for double-digit tabs.
          const numberWidth = () => String(tabNumber()).length + 1
          // Hovering reveals the close mark, so the title's right bound shifts left of it.
          const availableTitleWidth = () =>
            Math.max(1, width() - 1 - numberWidth() - (hovered() === tab.sessionID ? 2 : 0))
          const visibleTitle = createMemo(() => Locale.takeWidth(title(), availableTitleWidth()))
          const visibleTitleParts = createMemo(() => Locale.graphemes(visibleTitle()))
          // A new title wipes in from the left over the previous one.
          const displayedParts = createMemo(() => {
            const outgoing = outgoingTitle()
            const front = wipe.value().front
            const parts = visibleTitleParts()
            if (outgoing === undefined || front >= 1) return parts
            const previous = Locale.graphemes(Locale.takeWidth(outgoing, availableTitleWidth()))
            const cut = Math.round(front * Math.max(parts.length, previous.length))
            return [...parts.slice(0, cut), ...previous.slice(cut)]
          })
          const fadeWidth = () => 4
          const fadedTitleParts = createMemo(() => displayedParts().slice(-fadeWidth()))
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
              onMouseDown={() => setDragging(tab.sessionID)}
              onMouseUp={() => {
                setDragging(undefined)
                tabs.select(tab.sessionID)
              }}
              onMouseDrag={(event) => {
                const slot = slotAt(event.x)
                if (slot === undefined) return
                if (slot !== items().findIndex((item) => item.sessionID === tab.sessionID)) {
                  tabs.move(tab.sessionID, slot)
                }
              }}
              onMouseDragEnd={() => {
                // Releasing a drag selects the dragged tab, matching browser tab strips and
                // keeping sloppy clicks indistinguishable from clean ones.
                setDragging(undefined)
                tabs.select(tab.sessionID)
              }}
            >
              <TabPulse
                enabled={animations()}
                active={status().busy && !status().attention}
                complete={status().complete && !status().attention}
                glow={glows()}
                breathe={status().attention}
                color={pulseColor()}
                glowColor={glowColor()}
                completionColor={accent()}
                backgroundColor={pulseBackground()}
              />
              <box zIndex={1} width="100%" flexDirection="row">
                <text width={1} selectable={false}>
                  {" "}
                </text>
                <text
                  width={numberWidth()}
                  fg={numberColor()}
                  selectable={false}
                  attributes={selected() || dragged() ? TextAttributes.BOLD : undefined}
                >
                  {tabNumber()}
                </text>
                <Show
                  when={titleFades()}
                  fallback={
                    <text
                      width={availableTitleWidth()}
                      fg={foreground()}
                      wrapMode="none"
                      selectable={false}
                      attributes={selected() || dragged() ? TextAttributes.BOLD : undefined}
                    >
                      {displayedParts().join("")}
                    </text>
                  }
                >
                  <text
                    width={availableTitleWidth()}
                    fg={foreground()}
                    wrapMode="none"
                    selectable={false}
                    attributes={selected() || dragged() ? TextAttributes.BOLD : undefined}
                  >
                    {displayedParts().slice(0, -fadeWidth()).join("")}
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
                  selectable={false}
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
        <text width={sessionTabOverflowWidth(layout().after)} fg={theme.text.subdued} selectable={false}>
          {" " + layout().after}›
        </text>
      </Show>
    </box>
  )
}
