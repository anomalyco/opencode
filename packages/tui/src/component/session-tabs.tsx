import { RGBA, ScrollBoxRenderable, TextAttributes, type MouseEvent } from "@opentui/core"
import {
  For,
  Match,
  Show,
  Switch,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js"
import { Portal, useTerminalDimensions } from "@opentui/solid"
import { useConfig } from "../config"
import { useSessionTabs } from "../context/session-tabs"
import { useData } from "../context/data"
import { useTheme, useThemes } from "../context/theme"
import {
  adaptiveSessionTabLayout,
  moveSessionTab,
  NEW_SESSION_TAB_TITLE,
  sessionTabComplete,
  sessionTabDetail,
  sessionTabShortcutLabel,
  seedSessionTabMotion,
  sessionTabOverflowWidth,
  type SessionTab,
  type SessionTabUnread,
} from "../context/session-tabs-model"
import { createAnimatable, spring, tween } from "../ui/animation"
import { Locale } from "../util/locale"
import { TabPulse, unreadGlowIntensity } from "./tab-pulse"
import { tint } from "../theme/color"
import { SESSION_SIDEBAR_WIDTH } from "../ui/layout"
import { projectName } from "../util/project"
import { marqueeCycleWidth, marqueeOverflows, marqueeText } from "../util/marquee"
import { useDialog } from "../ui/dialog"
import { DialogSessionRename } from "./dialog-session-rename"

// A long title fades out over its last cells instead of cutting hard.
const FADE_WIDTH = 4
// The add button renders as " + " at the end of the strip, so the tab layout leaves it room.
const ADD_TAB_WIDTH = 3
const MARQUEE_DELAY = 600
const MARQUEE_INTERVAL = 100
const CONTEXT_MENU_WIDTH = 16
const RIGHT_MOUSE_BUTTON = 2

type TabContextMenuState = {
  x: number
  y: number
  sessionID?: string
  title?: string
}

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
  add?: () => void
  detail?: (sessionID: string) => string | undefined
  status(sessionID: string): SessionTabsStatus
}
const NEW_SESSION_TAB: SessionTab = { sessionID: "new", title: NEW_SESSION_TAB_TITLE }
const glowTextColor = (base: RGBA, glow: RGBA, index: number, width: number, level = 1) =>
  tint(base, glow, 0.12 * unreadGlowIntensity(index, width) * level)

function createNumberIgnition(runs: () => boolean, prompt: () => number, animations: () => boolean) {
  const ignition = createAnimatable({ level: 0 }, { enabled: animations, transition: tween({ duration: 0.7 }) })
  let wasRunning = runs()
  let promptPulse = prompt()
  createEffect(() => {
    const running = runs()
    const nextPromptPulse = prompt()
    if (running !== wasRunning || nextPromptPulse !== promptPulse) {
      ignition.jump({ level: 0.85 })
      ignition.animate({ level: 0 })
    }
    wasRunning = running
    promptPulse = nextPromptPulse
  })
  return ignition
}

function fadeTitleColor(color: RGBA, background: RGBA, index: number, length: number, leading: number) {
  const fade = (position: number) => (position <= 0 ? 0 : 0.2 + 0.72 * ((position - 1) / Math.max(1, FADE_WIDTH - 1)))
  const start = index < FADE_WIDTH ? FADE_WIDTH - index : 0
  const end = index - (length - FADE_WIDTH) + 1
  const opacity = Math.max(fade(start) * leading, fade(end))
  return opacity === 0 ? color : tint(color, background, opacity)
}

export function createMarquee(animations: () => boolean) {
  const [offset, setOffset] = createSignal(0)
  const [active, setActive] = createSignal<string>()
  const leading = createAnimatable({ opacity: 0 }, { enabled: animations, transition: tween({ duration: 0.25 }) })
  let delay: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let cycleWidth = 0

  const clear = () => {
    if (delay) clearTimeout(delay)
    if (interval) clearInterval(interval)
    delay = undefined
    interval = undefined
  }
  const scroll = () => {
    interval = setInterval(() => setOffset((value) => (value + 1) % cycleWidth), MARQUEE_INTERVAL)
  }
  const enter = (sessionID: string, title: string, width: number) => {
    if (!marqueeOverflows(title, width)) {
      reset()
      return
    }
    if (active() === sessionID) return
    clear()
    cycleWidth = marqueeCycleWidth(title)
    setActive(sessionID)
    setOffset(0)
    leading.jump({ opacity: 0 })
    delay = setTimeout(() => {
      setOffset(1)
      leading.animate({ opacity: 1 })
      scroll()
    }, MARQUEE_DELAY)
  }
  const leave = (sessionID: string) => {
    if (active() !== sessionID) return
    reset()
  }
  const reset = () => {
    clear()
    setActive(undefined)
    setOffset(0)
    leading.jump({ opacity: 0 })
  }
  onCleanup(clear)

  return { offset, active, enter, leave, reset, leading: () => leading.value().opacity }
}

export function createTabMarquee(animations: () => boolean) {
  const [hovered, setHovered] = createSignal<string>()
  const marquee = createMarquee(animations)
  let hoverClear: ReturnType<typeof setTimeout> | undefined

  const enter = (sessionID: string, title: string, width: number) => {
    if (hoverClear) clearTimeout(hoverClear)
    setHovered(sessionID)
    marquee.enter(sessionID, title, width)
  }
  const leave = (sessionID: string) => {
    if (hoverClear) clearTimeout(hoverClear)
    hoverClear = setTimeout(() => {
      if (hovered() !== sessionID) return
      setHovered(undefined)
      marquee.leave(sessionID)
    })
  }
  const leaveHovered = () => {
    const sessionID = hovered()
    if (sessionID) leave(sessionID)
  }
  const reset = () => {
    if (hoverClear) clearTimeout(hoverClear)
    hoverClear = undefined
    setHovered(undefined)
    marquee.reset()
  }
  onCleanup(() => {
    if (hoverClear) clearTimeout(hoverClear)
  })

  return { ...marquee, hovered, enter, leave, leaveHovered, reset }
}

function TabContextMenu(props: { state: TabContextMenuState; tabs: SessionTabsController; onClose: () => void }) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme("elevated")
  const dialog = useDialog()
  const actions = createMemo(() => {
    const sessionID = props.state.sessionID
    return [
      ...(props.tabs.add ? [{ title: "New tab", run: () => props.tabs.add?.() }] : []),
      ...(sessionID
        ? [
            {
              title: "Rename",
              run: () => DialogSessionRename.show(dialog, sessionID, props.state.title),
            },
            { title: "Close", run: () => props.tabs.close(sessionID) },
          ]
        : []),
    ]
  })
  const [selected, setSelected] = createSignal<number>()
  const top = () => Math.max(0, Math.min(props.state.y + 1, dimensions().height - actions().length))
  const left = () => Math.max(0, Math.min(props.state.x, dimensions().width - CONTEXT_MENU_WIDTH))
  const run = (index: number) => {
    const action = actions()[index]
    props.onClose()
    action?.run()
  }

  return (
    <Portal>
      <box
        position="absolute"
        left={0}
        top={0}
        width={dimensions().width}
        height={dimensions().height}
        zIndex={2500}
        onMouseDown={(event) => {
          props.onClose()
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <box
          position="absolute"
          left={left()}
          top={top()}
          height={actions().length}
          width={CONTEXT_MENU_WIDTH}
          flexDirection="column"
          backgroundColor={theme.background.default}
          onMouseDown={(event) => {
            if (event.button === RIGHT_MOUSE_BUTTON) props.onClose()
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <For each={actions()}>
            {(action, index) => (
              <box
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected() === index() ? theme.background.action.primary.hovered : undefined}
                onMouseOver={() => setSelected(index())}
                onMouseOut={() => setSelected(undefined)}
                onMouseUp={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (event.button === RIGHT_MOUSE_BUTTON) return
                  run(index())
                }}
              >
                <text fg={theme.text.default} selectable={false}>
                  {action.title}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </Portal>
  )
}

export function SessionTabs(
  props: {
    controller?: SessionTabsController
    animations?: boolean
    orientation?: "horizontal" | "vertical"
    width?: number
  } = {},
) {
  return (
    <Switch>
      <Match when={props.orientation === "vertical"}>
        <VerticalSessionTabs controller={props.controller} animations={props.animations} width={props.width} />
      </Match>
      <Match when={true}>
        <HorizontalSessionTabs controller={props.controller} animations={props.animations} />
      </Match>
    </Switch>
  )
}

function VerticalSessionTabs(props: { controller?: SessionTabsController; animations?: boolean; width?: number }) {
  const contextTabs = useSessionTabs()
  const tabs: SessionTabsController = props.controller ?? contextTabs
  const data = useData()
  const theme = useTheme("elevated")
  const { mode } = useThemes()
  const config = useConfig().data
  const animations = () => props.animations ?? config.animations ?? true
  const width = () => props.width ?? SESSION_SIDEBAR_WIDTH
  const hueStep = () => (mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const activeNumber = () => theme.hue.interactive[hueStep()]
  const idleNumber = () => tint(theme.text.subdued, theme.background.default, 0.35)
  const separatorUpperPulseColor = createMemo(() => tint(theme.background.default, theme.text.default, 0.04))
  const separatorLowerPulseColor = createMemo(() => tint(theme.background.default, theme.text.default, 0.05))
  const [addHovered, setAddHovered] = createSignal(false)
  const marquee = createTabMarquee(animations)
  const hovered = marquee.hovered
  const [dragging, setDragging] = createSignal<string>()
  const [preview, setPreview] = createSignal<{ sessionID: string; index: number }>()
  const [contextMenu, setContextMenu] = createSignal<TabContextMenuState>()
  const newTab = () => tabs.newTab?.() ?? false
  const activeID = createMemo(() => (newTab() ? undefined : tabs.current()))
  const ordered = createMemo(() => {
    const pending = preview()
    if (!pending) return tabs.tabs()
    return moveSessionTab(tabs.tabs(), pending.sessionID, pending.index)
  })
  const items = ordered
  createEffect(() => {
    const active = marquee.active()
    if (active && !items().some((tab) => tab.sessionID === active)) marquee.reset()
  })
  const statuses = createMemo(
    () =>
      new Map(
        items().map((tab) => {
          const status = tabs.status(tab.sessionID)
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
  let rail: { screenX: number; screenY: number } | undefined
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const pending = preview()
    if (!pending || dragging()) return
    const index = tabs.tabs().findIndex((tab) => tab.sessionID === pending.sessionID)
    if (index === -1 || index === Math.min(pending.index, tabs.tabs().length - 1)) setPreview(undefined)
  })

  createEffect(() => {
    if (!scroll) return
    // The promoted new-session slot sits below the list, so bring the rail's bottom into view.
    if (newTab()) return scroll.scrollTo(Math.max(0, items().length * 3 + 1 - scroll.viewport.height))
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
      position="relative"
      paddingTop={1}
      backgroundColor={theme.background.default}
      onMouseOut={marquee.leaveHovered}
    >
      <scrollbox ref={(element) => (scroll = element)} flexGrow={1} scrollbarOptions={{ visible: false }}>
        <box flexShrink={0} flexDirection="column" gap={1}>
          <For each={items()}>
            {(tab, index) => {
              const selected = () => activeID() === tab.sessionID
              const status = createMemo(() => itemStatus(tab))
              const [sweepLevel, setSweepLevel] = createSignal(0)
              const [closeHovered, setCloseHovered] = createSignal(false)
              const session = createMemo(() => data.session.get(tab.sessionID))
              const project = createMemo(() => {
                const value = session()
                return value ? data.project.get(value.projectID) : undefined
              })
              const numberWidth = () => 2
              const restingTitleWidth = () => Math.max(1, width() - numberWidth() - 2)
              const hoveredTitleWidth = () => Math.max(1, restingTitleWidth() - 1)
              const titleWidth = () => (hovered() === tab.sessionID ? hoveredTitleWidth() : restingTitleWidth())
              const title = () => tab.title ?? "Untitled session"
              const scrolling = () => marquee.active() === tab.sessionID
              const visibleTitle = createMemo(() =>
                scrolling()
                  ? marqueeText(title(), titleWidth(), marquee.offset())
                  : Locale.takeWidth(title(), titleWidth()),
              )
              const visibleTitleParts = createMemo(() => Locale.graphemes(visibleTitle()))
              const titleFades = createMemo(() => marqueeOverflows(title(), titleWidth()) && titleWidth() > FADE_WIDTH)
              const detail = createMemo(() => {
                const fixture = tabs.detail?.(tab.sessionID)
                if (fixture !== undefined) return fixture
                const value = session()
                const currentProject = project()
                const projectLabel = projectName(currentProject, value?.location.directory) ?? ""
                const vcs = value ? data.location.vcs.info(value.location) : undefined
                const location = value ? data.location.info(value.location) : undefined
                const worktree = !!location && location.project.directory !== location.project.canonical
                return sessionTabDetail(projectLabel, vcs?.branch.current, vcs?.branch.default, worktree)
              })
              const visibleDetail = createMemo(() => Locale.takeWidth(detail(), titleWidth()))
              const visibleDetailParts = createMemo(() => Locale.graphemes(visibleDetail()))
              const detailFades = createMemo(
                () => marqueeOverflows(detail(), titleWidth()) && titleWidth() > FADE_WIDTH,
              )
              const background = createMemo(() => {
                if (selected()) return theme.background.action.primary.selected
                if (hovered() === tab.sessionID || dragging() === tab.sessionID)
                  return theme.background.action.primary.hovered
                return theme.background.default
              })
              const pulseBackground = createMemo(() => tint(theme.background.default, background(), background().a))
              const runs = () => status().runs
              const numberIgnition = createNumberIgnition(runs, () => status().promptPulse, animations)
              const numberColor = () => {
                const base =
                  hovered() === tab.sessionID && !selected()
                    ? foreground()
                    : tint(idleNumber(), tint(theme.text.default, pulseBackground(), 0.25), Number(selected()))
                const color = tint(base, glowHue(), numberGlow.value().level)
                const runningColor = runs() ? activeNumber() : color
                return sweepLevel() === 0
                  ? tint(runningColor, theme.text.default, numberIgnition.value().level)
                  : tint(runningColor, theme.text.default, Math.max(numberIgnition.value().level, 0.35 * sweepLevel()))
              }
              const foreground = () => {
                if (hovered() === tab.sessionID) return theme.text.default
                return selected() ? theme.text.default : theme.text.subdued
              }
              const complete = () => status().complete
              // Latched so a resolving glow fades out in the hue it lit with instead of snapping to accent.
              let lastGlowHue: RGBA | undefined
              const glowHue = () => {
                if (status().attention) return (lastGlowHue = theme.text.feedback.warning.default)
                if (status().unread === "error") return (lastGlowHue = theme.text.feedback.error.default)
                if (status().unread !== undefined) return (lastGlowHue = accent())
                return lastGlowHue ?? accent()
              }
              const pulseColor = createMemo(() => tint(pulseBackground(), theme.text.default, 0.25))
              const flashColor = createMemo(() => tint(pulseBackground(), theme.text.default, 0.7))
              const glowColor = createMemo(() => tint(pulseBackground(), glowHue(), 0.45))
              const detailPulseColor = createMemo(() => tint(pulseBackground(), theme.text.default, 0.13))
              const detailFlashColor = createMemo(() => tint(pulseBackground(), theme.text.default, 0.42))
              const detailGlowColor = createMemo(() => tint(pulseBackground(), glowHue(), 0.25))
              const detailColor = createMemo(() => tint(theme.text.subdued, pulseBackground(), 0.35))
              const detailTextColor = (index: number) =>
                detailFades()
                  ? fadeTitleColor(detailColor(), pulseBackground(), index, visibleDetailParts().length, 0)
                  : detailColor()
              const glows = () => status().glows
              // Text tints ride an eased level so they diffuse away with the background glow instead of snapping.
              const titleGlow = createAnimatable(
                { level: 0 },
                { enabled: animations, transition: tween({ duration: 0.4 }) },
              )
              createEffect(() => titleGlow.animate({ level: glows() ? 1 : 0 }))
              const numberGlow = createAnimatable(
                { level: 0 },
                { enabled: animations, transition: tween({ duration: 0.4 }) },
              )
              createEffect(() =>
                numberGlow.animate({
                  level: status().attention || status().unread === "error" || complete() ? 1 : 0,
                }),
              )
              const previous = createMemo(() => items()[index() - 1])
              const previousStatus = createMemo(() => {
                const tab = previous()
                return tab
                  ? itemStatus(tab)
                  : { ...EMPTY_SESSION_TAB_STATUS, complete: false, runs: false, glows: false }
              })
              const previousGlows = () => previousStatus().glows
              const previousRuns = () => previousStatus().runs
              const indicatorWidth = 10
              let lastPreviousGlowHue: RGBA | undefined
              const previousGlowHue = () => {
                if (previousStatus().attention) return (lastPreviousGlowHue = theme.text.feedback.warning.default)
                if (previousStatus().unread === "error")
                  return (lastPreviousGlowHue = theme.text.feedback.error.default)
                if (previousStatus().unread !== undefined) return (lastPreviousGlowHue = accent())
                return lastPreviousGlowHue ?? accent()
              }
              const separatorUpperColor = createMemo(() => tint(theme.background.default, previousGlowHue(), 0.1))
              const separatorLowerColor = createMemo(() => tint(theme.background.default, glowHue(), 0.12))
              const titleColor = (index: number) => {
                const level = titleGlow.value().level
                const color =
                  level === 0
                    ? foreground()
                    : glowTextColor(foreground(), glowColor(), 1 + numberWidth() + index, width(), level)
                return titleFades()
                  ? fadeTitleColor(
                      color,
                      pulseBackground(),
                      index,
                      visibleTitleParts().length,
                      scrolling() ? marquee.leading() : 0,
                    )
                  : color
              }
              const release = () => {
                setDragging(undefined)
                const pending = preview()
                if (pending?.sessionID === tab.sessionID) tabs.move(pending.sessionID, pending.index)
                tabs.select(tab.sessionID)
              }
              return (
                <box
                  height={2}
                  width="100%"
                  position="relative"
                  flexDirection="column"
                  backgroundColor={background()}
                  onMouseOver={() => marquee.enter(tab.sessionID, title(), hoveredTitleWidth())}
                  onMouseOut={() => marquee.leave(tab.sessionID)}
                  onMouseDown={(event) => {
                    if (event.button === RIGHT_MOUSE_BUTTON) {
                      setDragging(undefined)
                      if (!rail) return
                      setContextMenu({
                        x: event.x,
                        y: event.y,
                        sessionID: tab.sessionID,
                        title: tab.title,
                      })
                      event.preventDefault()
                      event.stopPropagation()
                      return
                    }
                    marquee.enter(tab.sessionID, title(), hoveredTitleWidth())
                    setDragging(tab.sessionID)
                  }}
                  onMouseUp={(event) => {
                    if (event.button === RIGHT_MOUSE_BUTTON) return
                    release()
                  }}
                  onMouseDrag={(event) => {
                    if (!rail) return
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
                    color={separatorLowerPulseColor()}
                    width={indicatorWidth}
                    outerColor={separatorUpperPulseColor()}
                    flashColor={tint(theme.background.default, theme.text.default, 0.22)}
                    outerFlashColor={tint(theme.background.default, theme.text.default, 0.18)}
                    flashTail={8}
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
                      color={tint(theme.background.default, theme.text.default, 0.04)}
                      width={indicatorWidth}
                      outerColor={tint(theme.background.default, theme.text.default, 0.006)}
                      flashColor={tint(theme.background.default, theme.text.default, 0.18)}
                      flashTail={8}
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
                      active={runs()}
                      promptPulse={status().promptPulse}
                      complete={complete() && !status().attention}
                      glow={glows()}
                      color={pulseColor()}
                      width={indicatorWidth}
                      glowColor={glowColor()}
                      flashColor={flashColor()}
                      flashTail={8}
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
                        {sessionTabShortcutLabel(index())}
                      </text>
                      <text
                        width={titleWidth()}
                        fg={foreground()}
                        wrapMode="none"
                        selectable={false}
                        attributes={selected() ? TextAttributes.BOLD : undefined}
                      >
                        <Show when={titleGlow.value().level > 0 || titleFades()} fallback={visibleTitle()}>
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
                        fg={closeHovered() ? theme.text.default : theme.text.subdued}
                        selectable={false}
                        onMouseOver={() => setCloseHovered(true)}
                        onMouseOut={() => setCloseHovered(false)}
                        onMouseUp={(event) => {
                          if (event.button === RIGHT_MOUSE_BUTTON) return
                          if (hovered() !== tab.sessionID) return
                          event.stopPropagation()
                          tabs.close(tab.sessionID)
                        }}
                      >
                        {hovered() === tab.sessionID ? "✕" : ""}
                      </text>
                    </box>
                  </box>
                  <box height={1} width="100%" position="relative" flexDirection="row">
                    <TabPulse
                      enabled={animations()}
                      active={runs()}
                      promptPulse={status().promptPulse}
                      complete={complete() && !status().attention}
                      glow={glows()}
                      color={detailPulseColor()}
                      width={indicatorWidth}
                      glowColor={detailGlowColor()}
                      glowTail={10}
                      flashColor={detailFlashColor()}
                      flashTail={8}
                      completionColor={detailGlowColor()}
                      backgroundColor={pulseBackground()}
                    />
                    <box zIndex={1} width="100%" flexDirection="row" paddingLeft={numberWidth() + 1} paddingRight={2}>
                      <text fg={detailColor()} wrapMode="none" selectable={false}>
                        <Show when={detailFades()} fallback={visibleDetail()}>
                          <For each={visibleDetailParts()}>
                            {(character, index) => <span style={{ fg: detailTextColor(index()) }}>{character}</span>}
                          </For>
                        </Show>
                      </text>
                    </box>
                  </box>
                </box>
              )
            }}
          </For>
          {/* One slot with two states: a subdued affordance that promotes in place into the
              active new-session tab, instead of spawning a separate pseudo tab above itself. */}
          <Show when={tabs.add || newTab()}>
            <box
              height={1}
              width="100%"
              position="relative"
              flexDirection="row"
              paddingLeft={1}
              backgroundColor={
                newTab()
                  ? theme.background.action.primary.selected
                  : addHovered()
                    ? theme.background.action.primary.hovered
                    : theme.background.default
              }
              onMouseOver={() => setAddHovered(true)}
              onMouseOut={() => setAddHovered(false)}
              onMouseDown={(event: MouseEvent) => {
                if (event.button !== RIGHT_MOUSE_BUTTON) return
                if (!rail) return
                setContextMenu({ x: event.x, y: event.y })
                event.preventDefault()
                event.stopPropagation()
              }}
              onMouseUp={(event: MouseEvent) => {
                if (event.button === RIGHT_MOUSE_BUTTON) return
                if (!newTab()) tabs.add?.()
              }}
            >
              <text
                width={2}
                fg={newTab() || addHovered() ? theme.text.default : idleNumber()}
                selectable={false}
                attributes={newTab() ? TextAttributes.BOLD : undefined}
              >
                +
              </text>
              <text
                fg={newTab() || addHovered() ? theme.text.default : theme.text.subdued}
                wrapMode="none"
                selectable={false}
                attributes={newTab() ? TextAttributes.BOLD : undefined}
              >
                {NEW_SESSION_TAB_TITLE}
              </text>
              <Show when={newTab()}>
                <text
                  position="absolute"
                  right={1}
                  zIndex={2}
                  width={1}
                  fg={theme.text.subdued}
                  selectable={false}
                  onMouseUp={(event) => {
                    if (event.button === RIGHT_MOUSE_BUTTON) return
                    if (!addHovered()) return
                    event.stopPropagation()
                    tabs.close()
                  }}
                >
                  {addHovered() ? "×" : ""}
                </text>
              </Show>
            </box>
          </Show>
        </box>
      </scrollbox>
      <Show when={contextMenu()}>
        {(state) => <TabContextMenu state={state()} tabs={tabs} onClose={() => setContextMenu(undefined)} />}
      </Show>
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
  const [addHovered, setAddHovered] = createSignal(false)
  const marquee = createTabMarquee(animations)
  const hovered = marquee.hovered
  const [dragging, setDragging] = createSignal<string>()
  // A drag reorders a local preview and persists one move on release instead of writing
  // per slot crossing; the preview holds after release until the store reflects the move,
  // so the strip never flashes the pre-drag order while the write is in flight.
  const [preview, setPreview] = createSignal<{ sessionID: string; index: number }>()
  const [contextMenu, setContextMenu] = createSignal<TabContextMenuState>()
  let strip: { screenX: number; screenY: number } | undefined
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
  // The promoted new-session slot joins the strip as the active tab; the idle plus affordance
  // and the promoted slot are mutually exclusive states of one control.
  const items = createMemo(() => (newTab() ? [...ordered(), NEW_SESSION_TAB] : ordered()))
  const showPlus = () => Boolean(tabs.add) && !newTab()
  createEffect(() => {
    const pending = preview()
    if (!pending || dragging()) return
    const index = tabs.tabs().findIndex((tab) => tab.sessionID === pending.sessionID)
    if (index === -1 || index === Math.min(pending.index, tabs.tabs().length - 1)) setPreview(undefined)
  })
  const layout = createMemo((previous: ReturnType<typeof adaptiveSessionTabLayout> | undefined) =>
    adaptiveSessionTabLayout(
      items(),
      activeID(),
      dimensions().width - (showPlus() ? ADD_TAB_WIDTH : 0),
      previous?.start,
    ),
  )
  createEffect(() => {
    const active = marquee.active()
    if (active && !layout().tabs.some((tab) => tab.sessionID === active)) marquee.reset()
  })
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
      onMouseOut={marquee.leaveHovered}
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
          const tabNumber = createMemo(() => items().findIndex((item) => item.sessionID === tab.sessionID) + 1)
          // Shortcut labels stay one cell wide: 1-9, 0 for ten, then a neutral dot.
          const numberWidth = () => 2
          // Hovering reveals the close mark, so the title's right bound shifts left of it.
          const restingTitleWidth = () => Math.max(1, width() - 1 - numberWidth())
          const hoveredTitleWidth = () => Math.max(1, restingTitleWidth() - 2)
          const availableTitleWidth = () => (hovered() === tab.sessionID ? hoveredTitleWidth() : restingTitleWidth())
          const scrolling = () => marquee.active() === tab.sessionID
          const visibleTitle = createMemo(() =>
            scrolling()
              ? marqueeText(title(), availableTitleWidth(), marquee.offset())
              : Locale.takeWidth(title(), availableTitleWidth()),
          )
          const visibleTitleParts = createMemo(() => Locale.graphemes(visibleTitle()))
          const titleFades = createMemo(
            () => marqueeOverflows(title(), availableTitleWidth()) && availableTitleWidth() > FADE_WIDTH,
          )
          const runs = () => status().busy && !status().attention
          const numberIgnition = createNumberIgnition(runs, () => status().promptPulse, animations)
          const foreground = () => {
            if (hovered() === tab.sessionID) return theme.text.default
            return tint(theme.text.subdued, theme.text.default, selection())
          }
          // Title characters sitting over the glow tinge toward its color, following the same
          // spatial falloff as the glow itself; characters beyond the tail stay neutral.
          const characterColor = (index: number) => {
            const base = foreground()
            const color = glows() ? glowTextColor(base, glowColor(), 1 + numberWidth() + index, width()) : base
            return titleFades()
              ? fadeTitleColor(
                  color,
                  background(),
                  index,
                  visibleTitleParts().length,
                  scrolling() ? marquee.leading() : 0,
                )
              : color
          }
          // The running sweep's level under the number cell, reported by the pulse renderable.
          const [sweepLevel, setSweepLevel] = createSignal(0)
          const [closeHovered, setCloseHovered] = createSignal(false)
          const numberColor = () => {
            const feedback = feedbackColor()
            const base =
              hovered() === tab.sessionID && !selected()
                ? foreground()
                : tint(idleNumber(), tint(theme.text.default, background(), 0.25), selection())
            const color = feedback ?? (runs() ? activeNumber() : tint(base, accent(), activity()))
            // The number brightens faintly as the running sweep passes beneath it.
            return tint(color, theme.text.default, Math.max(numberIgnition.value().level, 0.15 * sweepLevel()))
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
              onMouseOver={() => marquee.enter(tab.sessionID, title(), hoveredTitleWidth())}
              onMouseOut={() => marquee.leave(tab.sessionID)}
              onMouseDown={(event) => {
                if (event.button === RIGHT_MOUSE_BUTTON) {
                  setDragging(undefined)
                  setContextMenu({
                    x: event.x,
                    y: event.y,
                    sessionID: tab === NEW_SESSION_TAB ? undefined : tab.sessionID,
                    title: tab === NEW_SESSION_TAB ? undefined : tab.title,
                  })
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                marquee.enter(tab.sessionID, title(), hoveredTitleWidth())
                setDragging(tab.sessionID)
              }}
              onMouseUp={(event) => {
                if (event.button === RIGHT_MOUSE_BUTTON) return
                release()
              }}
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
                  {tab === NEW_SESSION_TAB ? "+" : sessionTabShortcutLabel(tabNumber() - 1)}
                </text>
                <text
                  width={availableTitleWidth()}
                  fg={foreground()}
                  wrapMode="none"
                  selectable={false}
                  attributes={bold()}
                >
                  <Show when={glows() || titleFades()} fallback={visibleTitle()}>
                    <For each={visibleTitleParts()}>
                      {(character, index) => <span style={{ fg: characterColor(index()) }}>{character}</span>}
                    </For>
                  </Show>
                </text>
                <text
                  position="absolute"
                  right={1}
                  zIndex={2}
                  width={1}
                  fg={closeHovered() ? theme.text.default : closeColor()}
                  selectable={false}
                  onMouseOver={() => setCloseHovered(true)}
                  onMouseOut={() => setCloseHovered(false)}
                  onMouseUp={(event) => {
                    if (event.button === RIGHT_MOUSE_BUTTON) return
                    // The close mark only renders while hovered; without motion events a click can
                    // land here first, and must select the tab instead of closing it invisibly.
                    if (hovered() !== tab.sessionID) return
                    event.stopPropagation()
                    tabs.close(tab === NEW_SESSION_TAB ? undefined : tab.sessionID)
                  }}
                >
                  {hovered() === tab.sessionID ? "✕" : ""}
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
      <Show when={showPlus()}>
        <text
          width={ADD_TAB_WIDTH}
          fg={addHovered() ? theme.text.default : theme.text.subdued}
          bg={addHovered() ? theme.background.action.primary.hovered : undefined}
          selectable={false}
          onMouseOver={() => setAddHovered(true)}
          onMouseOut={() => setAddHovered(false)}
          onMouseDown={(event) => {
            if (event.button !== RIGHT_MOUSE_BUTTON) return
            setContextMenu({ x: event.x, y: event.y })
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseUp={(event) => {
            if (event.button === RIGHT_MOUSE_BUTTON) return
            tabs.add?.()
          }}
        >
          {" + "}
        </text>
      </Show>
      <Show when={contextMenu()}>
        {(state) => <TabContextMenu state={state()} tabs={tabs} onClose={() => setContextMenu(undefined)} />}
      </Show>
    </box>
  )
}
