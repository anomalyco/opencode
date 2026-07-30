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
  type SessionTab,
  type SessionTabUnread,
} from "../context/session-tabs-model"
import { createAnimatable, spring, tween } from "../ui/animation"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { TabPulse, unreadGlowIntensity } from "./tab-pulse"
import { tint } from "../theme/color"

// A long title fades out over its last cells instead of cutting hard.
const FADE_WIDTH = 4

type ContextController = ReturnType<typeof useSessionTabs>
export type SessionTabsStatus = Omit<ReturnType<ContextController["status"]>, "unread"> & {
  unread: SessionTabUnread | undefined
}
export const EMPTY_SESSION_TAB_STATUS: SessionTabsStatus = {
  unread: undefined,
  promptPulse: 0,
  attention: false,
  busy: false,
}
export type SessionTabsController = Pick<ContextController, "tabs" | "current" | "select" | "close" | "move"> & {
  newTab?: () => boolean
  status(sessionID: string): SessionTabsStatus
}

const NEW_SESSION_TAB: SessionTab = { sessionID: "new", title: "New session" }

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
  const newTab = () => tabs.newTab?.() ?? false
  const activeID = createMemo(() => (newTab() ? NEW_SESSION_TAB.sessionID : tabs.current()))
  const items = createMemo(() => (newTab() ? [...tabs.tabs(), NEW_SESSION_TAB] : tabs.tabs()))
  const layout = createMemo((previous: ReturnType<typeof adaptiveSessionTabLayout> | undefined) =>
    adaptiveSessionTabLayout(items(), activeID(), dimensions().width, previous?.start),
  )
  const statuses = createMemo(
    () =>
      new Map(
        layout().tabs.map((tab) => {
          const status = tab === NEW_SESSION_TAB ? EMPTY_SESSION_TAB_STATUS : tabs.status(tab.sessionID)
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
    const previous = signature
    signature = nextSignature
    total = layout().total
    if (!changed && !resized) return motion.animate(next)
    // Identity-stable total changes are terminal resizes and still jump.
    if (!changed) return motion.jump(next)
    const seeded = seedSessionTabMotion(
      previous.split(":"),
      layout().tabs.map((tab) => tab.sessionID),
      untrack(motion.value),
      next,
    )
    if (!seeded) return motion.jump(next)
    motion.jump(seeded)
    motion.animate(next)
  })

  const activeIndex = createMemo(() => layout().tabs.findIndex((tab) => tab.sessionID === activeID()))
  const visuals = createMemo(() => {
    const current = signature === identity() && total === layout().total ? motion.value() : targets()
    const widths = current.widths.map((width) => Math.max(1, Math.round(width)))
    const active = activeIndex()
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
          const background = createMemo(() => {
            const lifted = (hovered() === tab.sessionID || dragged()) && !selected()
            const base = lifted ? theme.background.action.primary.hovered : theme.background.default
            // A dragged tab lifts to full selected elevation while it is held.
            return tint(base, theme.raise(theme.background.surface.offset), dragged() ? 1 : selection())
          })
          const pulseColor = () => tint(background(), theme.text.default, 0.45)
          // The edge flash washes toward a brighter stop on the same background-to-text ramp,
          // so it reads as a lift of the pulse color rather than a different hue.
          const flashColor = () => tint(background(), theme.text.default, 0.65)
          const feedbackColor = () => {
            if (status().attention) return theme.text.feedback.warning.default
            if (status().unread === "error") return theme.text.feedback.error.default
            return undefined
          }
          const glowColor = () => feedbackColor() ?? accent()
          const glows = () => !selected() && (status().attention || (!status().busy && status().unread !== undefined))
          const title = () => tab.title ?? "Untitled session"
          const [outgoingTitle, setOutgoingTitle] = createSignal<string>()
          const wipe = createAnimatable({ front: 1 }, { enabled: animations, transition: tween({ duration: 0.3 }) })
          createEffect((previous: string) => {
            const next = title()
            if (next === previous) return next
            setOutgoingTitle(previous)
            wipe.jump({ front: 0 })
            wipe.animate({ front: 1 })
            return next
          }, title())
          const tabNumber = createMemo(() => items().findIndex((item) => item.sessionID === tab.sessionID) + 1)
          // The number cell keeps one trailing space, even for double-digit tabs.
          const numberWidth = () => String(tabNumber()).length + 1
          // Hovering reveals the close mark, so the title's right bound shifts left of it.
          const availableTitleWidth = () =>
            Math.max(1, width() - 1 - numberWidth() - (hovered() === tab.sessionID ? 2 : 0))
          const visibleTitle = createMemo(() => Locale.takeWidth(title(), availableTitleWidth()))
          const visibleTitleParts = createMemo(() => Locale.graphemes(visibleTitle()))
          const outgoingTitleParts = createMemo(() => {
            const outgoing = outgoingTitle()
            if (outgoing === undefined) return undefined
            return Locale.graphemes(Locale.takeWidth(outgoing, availableTitleWidth()))
          })
          // A new title wipes in from the left over the previous one.
          const displayedParts = createMemo(() => {
            const front = wipe.value().front
            const parts = visibleTitleParts()
            const previous = outgoingTitleParts()
            if (previous === undefined || front >= 1) return parts
            const cut = Math.round(front * Math.max(parts.length, previous.length))
            return [...parts.slice(0, cut), ...previous.slice(cut)]
          })
          const titleFades = createMemo(
            () => stringWidth(title()) >= availableTitleWidth() && availableTitleWidth() > FADE_WIDTH,
          )
          const foreground = () => {
            if (hovered() === tab.sessionID) return theme.text.default
            return tint(theme.text.subdued, theme.text.default, selection())
          }
          // Title characters sitting over the glow tinge toward its color, following the same
          // spatial falloff as the glow itself; characters beyond the tail stay neutral.
          const characterColor = (index: number) => {
            const base = foreground()
            const color = glows()
              ? tint(base, glowColor(), 0.12 * unreadGlowIntensity(1 + numberWidth() + index, width()))
              : base
            if (!titleFades() || index < displayedParts().length - FADE_WIDTH) return color
            const position = index - (displayedParts().length - FADE_WIDTH)
            return tint(color, background(), 0.2 + 0.72 * (position / Math.max(1, FADE_WIDTH - 1)))
          }
          // The running sweep's level under the number cell, reported by the pulse renderable.
          const [sweepLevel, setSweepLevel] = createSignal(0)
          const numberColor = () => {
            const feedback = feedbackColor()
            if (feedback) return feedback
            const base =
              hovered() === tab.sessionID && !selected()
                ? foreground()
                : tint(idleNumber(), activeNumber(), selection())
            const color = tint(base, accent(), activity())
            // The number brightens faintly as the running sweep passes beneath it.
            return sweepLevel() === 0 ? color : tint(color, theme.text.default, 0.15 * sweepLevel())
          }
          const bold = () => (selected() || dragged() ? TextAttributes.BOLD : undefined)
          const closeColor = () => tint(theme.text.subdued, theme.text.default, 0.6)
          // Releasing a drag (or a plain click) selects the tab, matching browser tab strips and
          // keeping sloppy clicks indistinguishable from clean ones.
          const release = () => {
            setDragging(undefined)
            if (tab === NEW_SESSION_TAB) return
            tabs.select(tab.sessionID)
          }
          return (
            <box
              width={width()}
              position="relative"
              flexDirection="row"
              backgroundColor={background()}
              onMouseOver={() => setHovered(tab.sessionID)}
              onMouseOut={() => setHovered(undefined)}
              onMouseDown={() => setDragging(tab.sessionID)}
              onMouseUp={release}
              onMouseDrag={(event) => {
                if (tab === NEW_SESSION_TAB) return
                const slot = slotAt(event.x)
                if (slot !== undefined && slot !== tabNumber() - 1) tabs.move(tab.sessionID, slot)
              }}
              onMouseDragEnd={release}
            >
              <TabPulse
                enabled={animations()}
                active={status().busy && !status().attention}
                promptPulse={status().promptPulse}
                complete={status().complete && !status().attention}
                glow={glows()}
                breathe={status().attention}
                color={pulseColor()}
                glowColor={glowColor()}
                flashColor={flashColor()}
                completionColor={accent()}
                backgroundColor={background()}
                onLevel={setSweepLevel}
              />
              <box zIndex={1} width="100%" flexDirection="row">
                <text width={1} selectable={false}>
                  {" "}
                </text>
                <text width={numberWidth()} fg={numberColor()} selectable={false} attributes={bold()}>
                  {tabNumber()}
                </text>
                <text
                  width={availableTitleWidth()}
                  fg={foreground()}
                  wrapMode="none"
                  selectable={false}
                  attributes={bold()}
                >
                  <Show when={glows() || titleFades()} fallback={displayedParts().join("")}>
                    <For each={displayedParts()}>
                      {(character, index) => <span style={{ fg: characterColor(index()) }}>{character}</span>}
                    </For>
                  </Show>
                </text>
                <text
                  position="absolute"
                  right={1}
                  zIndex={2}
                  width={1}
                  fg={closeColor()}
                  selectable={false}
                  onMouseUp={(event) => {
                    event.stopPropagation()
                    tabs.close(tab === NEW_SESSION_TAB ? undefined : tab.sessionID)
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
