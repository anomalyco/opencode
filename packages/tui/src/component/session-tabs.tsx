import { RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { For, Show, createComputed, createEffect, createMemo, createSignal, untrack } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useData } from "../context/data"
import { useTheme, useThemes } from "../context/theme"
import {
  adaptiveSessionTabLayout,
  moveSessionTab,
  NEW_SESSION_TAB_TITLE,
  sessionTabComplete,
  seedSessionTabMotion,
  sessionTabOverflowWidth,
  sessionTabVerticalWidth,
  type SessionTab,
  type SessionTabUnread,
} from "../context/session-tabs-model"
import { createAnimatable, spring, tween } from "../ui/animation"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { TabPulse, unreadGlowIntensity } from "./tab-pulse"
import { tint } from "../theme/color"
import { projectName } from "../util/project"

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

const NEW_SESSION_TAB: SessionTab = { sessionID: "new", title: NEW_SESSION_TAB_TITLE }
const glowTextColor = (base: RGBA, glow: RGBA, index: number, width: number) =>
  tint(base, glow, 0.12 * unreadGlowIntensity(index, width))

export function SessionTabs(
  props: { controller?: SessionTabsController; animations?: boolean; orientation?: "horizontal" | "vertical" } = {},
) {
  if (props.orientation === "vertical")
    return <VerticalSessionTabs controller={props.controller} animations={props.animations} />
  return <HorizontalSessionTabs controller={props.controller} animations={props.animations} />
}

function VerticalSessionTabs(props: { controller?: SessionTabsController; animations?: boolean }) {
  const tabs = props.controller ?? useSessionTabs()
  const data = useData()
  const dimensions = useTerminalDimensions()
  const theme = useTheme("elevated")
  const { mode } = useThemes()
  const config = useConfig().data
  const animations = () => props.animations ?? config.animations ?? true
  const width = () => sessionTabVerticalWidth(dimensions().width)
  const hueStep = () => (mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const activeNumber = () => theme.hue.interactive[hueStep()]
  const idleNumber = () => tint(theme.text.subdued, theme.background.default, 0.35)
  const [hovered, setHovered] = createSignal<string>()
  const [dragging, setDragging] = createSignal<string>()
  const [preview, setPreview] = createSignal<{ sessionID: string; index: number }>()
  const newTab = () => tabs.newTab?.() ?? false
  const activeID = createMemo(() => (newTab() ? NEW_SESSION_TAB.sessionID : tabs.current()))
  const ordered = createMemo(() => {
    const pending = preview()
    if (!pending) return tabs.tabs()
    return moveSessionTab(tabs.tabs(), pending.sessionID, pending.index)
  })
  const items = createMemo(() => (newTab() ? [...ordered(), NEW_SESSION_TAB] : ordered()))
  const statuses = createMemo(
    () =>
      new Map(
        items().map((tab) => {
          const status = tab === NEW_SESSION_TAB ? EMPTY_SESSION_TAB_STATUS : tabs.status(tab.sessionID)
          return [
            tab.sessionID,
            {
              ...status,
              complete: sessionTabComplete(status.unread, status.busy),
              runs: status.busy && !status.attention,
              glows:
                tab.sessionID !== activeID() && (status.attention || (!status.busy && status.unread !== undefined)),
            },
          ] as const
        }),
      ),
  )
  const itemStatus = (tab: SessionTab) => statuses().get(tab.sessionID)!
  let rail: { screenY: number } | undefined
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const pending = preview()
    if (!pending || dragging()) return
    const index = tabs.tabs().findIndex((tab) => tab.sessionID === pending.sessionID)
    if (index === -1 || index === Math.min(pending.index, tabs.tabs().length - 1)) setPreview(undefined)
  })

  createEffect(() => {
    if (!scroll) return
    const index = items().findIndex((tab) => tab.sessionID === activeID())
    if (index === -1) return
    const top = index * 3
    if (top < scroll.scrollTop) return scroll.scrollTo(top)
    if (top + 2 > scroll.scrollTop + scroll.viewport.height) {
      scroll.scrollTo(top + 2 - scroll.viewport.height)
    }
  })

  return (
    <box
      ref={(element) => (rail = element)}
      width={width()}
      height="100%"
      flexShrink={0}
      flexDirection="column"
      paddingTop={1}
      backgroundColor={theme.background.default}
    >
      <scrollbox ref={(element) => (scroll = element)} flexGrow={1} scrollbarOptions={{ visible: false }}>
        <box flexShrink={0} flexDirection="column" gap={1}>
          <For each={items()}>
            {(tab, index) => {
              const selected = () => activeID() === tab.sessionID
              const status = createMemo(() => itemStatus(tab))
              const [sweepLevel, setSweepLevel] = createSignal(0)
              const session = createMemo(() => (tab === NEW_SESSION_TAB ? undefined : data.session.get(tab.sessionID)))
              const project = createMemo(() => {
                const value = session()
                return value ? data.project.get(value.projectID) : undefined
              })
              const numberWidth = () => String(index() + 1).length + 1
              const titleWidth = () => Math.max(1, width() - numberWidth() - 2 - (hovered() === tab.sessionID ? 1 : 0))
              const title = () => tab.title ?? "Untitled session"
              const visibleTitle = createMemo(() => Locale.takeWidth(title(), titleWidth()))
              const visibleTitleParts = createMemo(() => Locale.graphemes(visibleTitle()))
              const titleFades = createMemo(() => stringWidth(title()) >= titleWidth() && titleWidth() > FADE_WIDTH)
              const detail = createMemo(() => {
                if (tab === NEW_SESSION_TAB) return Locale.takeWidth("Start a new session", titleWidth())
                const value = session()
                return Locale.takeWidth(projectName(project(), value?.location.directory) ?? "", titleWidth())
              })
              const background = createMemo(() => {
                if (selected()) return theme.background.action.primary.selected
                if (hovered() === tab.sessionID || dragging() === tab.sessionID)
                  return theme.background.action.primary.hovered
                return theme.background.default
              })
              const pulseBackground = createMemo(() => tint(theme.background.default, background(), background().a))
              const numberColor = () => {
                if (status().attention) return theme.text.feedback.warning.default
                if (status().unread === "error") return theme.text.feedback.error.default
                const base =
                  hovered() === tab.sessionID && !selected()
                    ? foreground()
                    : tint(idleNumber(), activeNumber(), Number(selected()))
                const color = tint(base, accent(), Number(complete()))
                return sweepLevel() === 0 ? color : tint(color, theme.text.default, 0.15 * sweepLevel())
              }
              const foreground = () => {
                if (hovered() === tab.sessionID) return theme.text.default
                return selected() ? theme.text.default : theme.text.subdued
              }
              const complete = () => status().complete
              const glowHue = () => {
                if (status().attention) return theme.text.feedback.warning.default
                if (status().unread === "error") return theme.text.feedback.error.default
                return accent()
              }
              const pulseColor = createMemo(() => tint(pulseBackground(), theme.text.default, 0.25))
              const glowColor = createMemo(() => tint(pulseBackground(), glowHue(), 0.45))
              const detailPulseColor = createMemo(() => tint(pulseBackground(), theme.text.default, 0.13))
              const detailGlowColor = createMemo(() => tint(pulseBackground(), glowHue(), 0.25))
              const detailColor = createMemo(() => tint(theme.text.subdued, pulseBackground(), 0.35))
              const glows = () => status().glows
              const previous = createMemo(() => items()[index() - 1])
              const previousStatus = createMemo(() => {
                const tab = previous()
                return tab
                  ? itemStatus(tab)
                  : { ...EMPTY_SESSION_TAB_STATUS, complete: false, runs: false, glows: false }
              })
              const previousGlows = () => previousStatus().glows
              const runs = () => status().runs
              const previousRuns = () => previousStatus().runs
              const previousGlowHue = () => {
                if (previousStatus().attention) return theme.text.feedback.warning.default
                if (previousStatus().unread === "error") return theme.text.feedback.error.default
                return accent()
              }
              const separatorUpperColor = createMemo(() => tint(theme.background.default, previousGlowHue(), 0.1))
              const separatorLowerColor = createMemo(() => tint(theme.background.default, glowHue(), 0.12))
              const separatorUpperPulseColor = createMemo(() =>
                tint(theme.background.default, theme.text.default, 0.04),
              )
              const separatorLowerPulseColor = createMemo(() =>
                tint(theme.background.default, theme.text.default, 0.05),
              )
              const titleColor = (index: number) => {
                const color = glows()
                  ? glowTextColor(foreground(), glowColor(), 1 + numberWidth() + index, width())
                  : foreground()
                if (!titleFades() || index < visibleTitleParts().length - FADE_WIDTH) return color
                const position = index - (visibleTitleParts().length - FADE_WIDTH)
                return tint(color, pulseBackground(), 0.2 + 0.72 * (position / Math.max(1, FADE_WIDTH - 1)))
              }
              const release = () => {
                setDragging(undefined)
                const pending = preview()
                if (pending?.sessionID === tab.sessionID) tabs.move(pending.sessionID, pending.index)
                if (tab !== NEW_SESSION_TAB) tabs.select(tab.sessionID)
              }
              return (
                <box
                  height={2}
                  width="100%"
                  position="relative"
                  flexDirection="column"
                  backgroundColor={background()}
                  onMouseOver={() => setHovered(tab.sessionID)}
                  onMouseOut={() => setHovered(undefined)}
                  onMouseDown={() => setDragging(tab.sessionID)}
                  onMouseUp={release}
                  onMouseDrag={(event) => {
                    if (!rail || tab === NEW_SESSION_TAB) return
                    const target = Math.max(
                      0,
                      Math.min(
                        tabs.tabs().length - 1,
                        Math.floor((event.y - rail.screenY - 1 + (scroll?.scrollTop ?? 0)) / 3),
                      ),
                    )
                    if (target !== index() && preview()?.index !== target)
                      setPreview({ sessionID: tab.sessionID, index: target })
                  }}
                  onMouseDragEnd={release}
                >
                  <TabPulse
                    top={-1}
                    edge="above"
                    enabled={animations()}
                    active={runs()}
                    outerActive={previousRuns()}
                    promptPulse={status().promptPulse}
                    outerPromptPulse={previousStatus().promptPulse}
                    complete={complete() && !status().attention}
                    outerComplete={previousStatus().complete && !previousStatus().attention}
                    glow={glows()}
                    outerGlow={previousGlows()}
                    breathe={status().attention}
                    outerBreathe={previousStatus().attention}
                    color={separatorLowerPulseColor()}
                    outerColor={separatorUpperPulseColor()}
                    glowColor={separatorLowerColor()}
                    outerGlowColor={separatorUpperColor()}
                    glowTail={8}
                    outerGlowTail={5}
                    completionColor={separatorLowerColor()}
                    outerCompletionColor={separatorUpperColor()}
                    backgroundColor={theme.background.default}
                  />
                  <Show when={index() === items().length - 1}>
                    <TabPulse
                      top={2}
                      edge="below"
                      enabled={animations()}
                      active={runs()}
                      outerActive={false}
                      promptPulse={status().promptPulse}
                      outerPromptPulse={0}
                      complete={complete() && !status().attention}
                      outerComplete={false}
                      glow={glows()}
                      outerGlow={false}
                      breathe={status().attention}
                      outerBreathe={false}
                      color={tint(theme.background.default, theme.text.default, 0.04)}
                      outerColor={tint(theme.background.default, theme.text.default, 0.006)}
                      glowColor={tint(theme.background.default, glowHue(), 0.1)}
                      outerGlowColor={theme.background.default}
                      glowTail={8}
                      outerGlowTail={5}
                      completionColor={tint(theme.background.default, glowHue(), 0.1)}
                      outerCompletionColor={theme.background.default}
                      backgroundColor={theme.background.default}
                    />
                  </Show>
                  <box height={1} width="100%" flexDirection="row" position="relative">
                    <TabPulse
                      enabled={animations()}
                      active={status().busy && !status().attention}
                      promptPulse={status().promptPulse}
                      complete={complete() && !status().attention}
                      glow={glows()}
                      breathe={status().attention}
                      color={pulseColor()}
                      glowColor={glowColor()}
                      completionColor={glowColor()}
                      backgroundColor={pulseBackground()}
                      onLevel={setSweepLevel}
                    />
                    <box zIndex={1} width="100%" flexDirection="row" paddingLeft={1} paddingRight={1}>
                      <text
                        width={numberWidth()}
                        fg={numberColor()}
                        selectable={false}
                        attributes={selected() ? TextAttributes.BOLD : undefined}
                      >
                        {index() + 1}
                      </text>
                      <text
                        width={titleWidth()}
                        fg={foreground()}
                        wrapMode="none"
                        selectable={false}
                        attributes={selected() ? TextAttributes.BOLD : undefined}
                      >
                        <Show when={glows() || titleFades()} fallback={visibleTitle()}>
                          <For each={visibleTitleParts()}>
                            {(character, index) => <span style={{ fg: titleColor(index()) }}>{character}</span>}
                          </For>
                        </Show>
                      </text>
                      <text
                        position="absolute"
                        right={1}
                        zIndex={2}
                        width={1}
                        fg={theme.text.subdued}
                        selectable={false}
                        onMouseUp={(event) => {
                          if (hovered() !== tab.sessionID) return
                          event.stopPropagation()
                          tabs.close(tab === NEW_SESSION_TAB ? undefined : tab.sessionID)
                        }}
                      >
                        {hovered() === tab.sessionID ? "×" : ""}
                      </text>
                    </box>
                  </box>
                  <box height={1} width="100%" position="relative" flexDirection="row">
                    <TabPulse
                      enabled={animations()}
                      active={status().busy && !status().attention}
                      promptPulse={status().promptPulse}
                      complete={complete() && !status().attention}
                      glow={glows()}
                      breathe={status().attention}
                      color={detailPulseColor()}
                      glowColor={detailGlowColor()}
                      glowTail={10}
                      completionColor={detailGlowColor()}
                      backgroundColor={pulseBackground()}
                    />
                    <box zIndex={1} width="100%" flexDirection="row" paddingLeft={numberWidth() + 1} paddingRight={2}>
                      <text fg={detailColor()} wrapMode="none" selectable={false}>
                        {detail()}
                      </text>
                    </box>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}

function HorizontalSessionTabs(props: { controller?: SessionTabsController; animations?: boolean } = {}) {
  const tabs = props.controller ?? useSessionTabs()
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const { mode } = useThemes()
  const config = useConfig().data
  const animations = () => props.animations ?? config.animations ?? true
  const [hovered, setHovered] = createSignal<string>()
  const [dragging, setDragging] = createSignal<string>()
  // A drag reorders a local preview and persists one move on release instead of writing
  // per slot crossing; the preview holds after release until the store reflects the move,
  // so the strip never flashes the pre-drag order while the write is in flight.
  const [preview, setPreview] = createSignal<{ sessionID: string; index: number }>()
  let strip: { screenX: number } | undefined
  const hueStep = () => (mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const activeNumber = () => theme.hue.interactive[hueStep()]
  const idleNumber = () => tint(theme.text.subdued, theme.background.default, 0.35)
  const newTab = () => tabs.newTab?.() ?? false
  const activeID = createMemo(() => (newTab() ? NEW_SESSION_TAB.sessionID : tabs.current()))
  const ordered = createMemo(() => {
    const pending = preview()
    if (!pending) return tabs.tabs()
    return moveSessionTab(tabs.tabs(), pending.sessionID, pending.index)
  })
  const items = createMemo(() => (newTab() ? [...ordered(), NEW_SESSION_TAB] : ordered()))
  createEffect(() => {
    const pending = preview()
    if (!pending || dragging()) return
    const index = tabs.tabs().findIndex((tab) => tab.sessionID === pending.sessionID)
    if (index === -1 || index === Math.min(pending.index, tabs.tabs().length - 1)) setPreview(undefined)
  })
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
            if (previous === NEW_SESSION_TAB_TITLE) {
              setOutgoingTitle(undefined)
              wipe.jump({ front: 1 })
              return next
            }
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
            const color = glows() ? glowTextColor(base, glowColor(), 1 + numberWidth() + index, width()) : base
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
            const pending = preview()
            if (pending?.sessionID === tab.sessionID) tabs.move(pending.sessionID, pending.index)
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
                if (slot !== undefined && slot !== tabNumber() - 1)
                  setPreview({ sessionID: tab.sessionID, index: slot })
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
                    // The close mark only renders while hovered; without motion events a click can
                    // land here first, and must select the tab instead of closing it invisibly.
                    if (hovered() !== tab.sessionID) return
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
