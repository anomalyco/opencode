import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { SessionMessageAssistant } from "@opencode-ai/client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { usePromptRef } from "../context/prompt"
import { useSessionTabs } from "../context/session-tabs"
import { sessionInboxGroup, sessionInboxWidth, type SessionInboxGroup } from "../context/session-tabs-model"
import { useTheme, useThemes } from "../context/theme"
import { tint } from "../theme/color"
import { getScrollAcceleration } from "../util/scroll"
import { withTimestampedFallback } from "@opencode-ai/util/session-title-fallback"
import { activityVerb } from "../util/activity-verb"
import { markdownPreview } from "../util/markdown-preview"
import { Spinner } from "./spinner"
import type { SessionTabsStatus } from "./session-tabs"

const labels: Record<SessionInboxGroup, string> = {
  running: "Active",
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
}

type SessionInboxRowInfo = {
  sessionID: string
  title: string
  updated: number
  preview: string
  status: SessionTabsStatus
  group: SessionInboxGroup
}

function SessionInboxRow(props: {
  row: SessionInboxRowInfo
  selected?: boolean
  focused?: boolean
  pendingDone?: boolean
  number?: number
  verb: string
  onSelect?: () => void
}) {
  const theme = useTheme("elevated")
  const themes = useThemes()
  const [hovered, setHovered] = createSignal(false)
  const hueStep = () => (themes.mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const background = () => {
    if (props.focused) return theme.background.action.primary.hovered
    if (props.selected) return theme.background.surface.offset
    if (hovered()) return theme.background.action.primary.hovered
    return theme.background.default
  }
  const feedback = () => {
    if (props.row.status.attention) return theme.text.feedback.warning.default
    if (props.row.status.unread === "error") return theme.text.feedback.error.default
    if (props.row.status.unread) return accent()
    return theme.text.subdued
  }

  return (
    <box
      height={4}
      id={`session-inbox-${props.row.sessionID}`}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      backgroundColor={background()}
      border={["left"]}
      borderColor={props.selected || props.focused ? accent() : background()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onSelect}
    >
      <box height={2} flexDirection="row">
        <Show when={props.number}>
          {(number) => (
            <text
              width={String(number()).length + 1}
              fg={props.selected || props.focused ? accent() : theme.text.subdued}
              selectable={false}
            >
              {number()}
            </text>
          )}
        </Show>
        <box height={2} flexGrow={1} minWidth={0}>
          <box height={1} flexDirection="row">
            <text
              flexGrow={1}
              flexShrink={1}
              fg={theme.text.default}
              attributes={props.selected || props.focused ? TextAttributes.BOLD : undefined}
              wrapMode="none"
              truncate
              selectable={false}
            >
              {props.row.title}
            </text>
            <Show when={props.row.status.attention || (!props.row.status.busy && props.row.status.unread)}>
              <text width={2} fg={feedback()} selectable={false}>
                ●
              </text>
            </Show>
          </box>
          <box height={1}>
            <Switch
              fallback={
                <text
                  height={1}
                  fg={tint(theme.text.subdued, theme.text.default, props.selected ? 0.25 : 0)}
                  wrapMode="none"
                  truncate
                  selectable={false}
                >
                  {props.row.preview}
                </text>
              }
            >
              <Match when={props.pendingDone}>
                <text fg={theme.text.feedback.warning.default} wrapMode="none" truncate>
                  Space again to mark done
                </text>
              </Match>
              <Match when={props.row.status.attention}>
                <text fg={theme.text.feedback.warning.default} wrapMode="none" truncate>
                  Action required
                </text>
              </Match>
              <Match when={props.row.status.busy}>
                  <Spinner color={accent()}>
                    <span style={{ fg: accent() }}>{props.verb}</span>
                </Spinner>
              </Match>
            </Switch>
          </box>
        </box>
      </box>
    </box>
  )
}

export function SessionInbox() {
  const tabs = useSessionTabs()
  const data = useData()
  const theme = useTheme("elevated")
  const themes = useThemes()
  const config = useConfig().data
  const prompt = usePromptRef()
  const keymap = Keymap.use()
  const dimensions = useTerminalDimensions()
  let scroll: ScrollBoxRenderable
  const [verbCycle, setVerbCycle] = createSignal(0)
  const [groupClock, setGroupClock] = createSignal(Date.now())
  const verbTimer = setInterval(() => setVerbCycle((value) => value + 1), 3_500)
  const groupTimer = setInterval(() => setGroupClock(Date.now()), 60_000)
  onCleanup(() => {
    clearInterval(verbTimer)
    clearInterval(groupTimer)
    tabs.navigation.blur()
  })
  const width = createMemo(() => sessionInboxWidth(dimensions().width))
  const hueStep = () => (themes.mode() === "light" ? 800 : 200)
  const accent = () => theme.hue.accent[hueStep()]
  const rows = createMemo(() => {
    return tabs
      .recent()
      .map((tab) => {
        const session = data.session.get(tab.sessionID)
        const status = tabs.status(tab.sessionID)
        const assistant = data.session.message
          .list(tab.sessionID)
          .findLast(
            (message): message is SessionMessageAssistant =>
              message.type === "assistant" && (!session?.revert?.messageID || message.id < session.revert.messageID),
          )
        const preview = assistant?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        const updated = tabs.updated(tab.sessionID)
        return {
          sessionID: tab.sessionID,
          title: session ? withTimestampedFallback(session) : (tab.title ?? "Loading session…"),
          updated,
          preview: markdownPreview(preview ?? "") || "No assistant response yet",
          status,
          group: sessionInboxGroup(updated, status.busy, groupClock()),
        }
      })
  })
  const groups = createMemo(() =>
    (["running", "today", "yesterday", "earlier"] as const)
      .map((group) => ({ group, rows: rows().filter((row) => row.group === group) }))
      .filter((group) => group.rows.length > 0),
  )
  const numbers = createMemo(() => new Map(rows().map((row, index) => [row.sessionID, index + 1])))

  createEffect(() => {
    if (!tabs.navigation.active()) return
    const sessionID = tabs.navigation.selected()
    if (!sessionID || !scroll || scroll.isDestroyed) return
    const row = scroll.getRenderable(`session-inbox-${sessionID}`)
    if (!row) return
    const top = scroll.scrollTop + row.y - scroll.viewport.y
    const bottom = top + row.height
    if (top < scroll.scrollTop) {
      scroll.scrollTo(top)
      return
    }
    if (bottom > scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(bottom - scroll.viewport.height)
  })

  const leave = () => {
    tabs.navigation.blur()
    prompt.current?.focus()
  }
  const newSession = () => {
    keymap.dispatch("session.new")
  }

  Keymap.createLayer(() => ({
    mode: "global",
    priority: 2,
    enabled: tabs.navigation.active,
    commands: [
      {
        bind: "up,shift+tab",
        title: "Previous session",
        group: "Session",
        run: () => tabs.navigation.move(-1),
      },
      {
        bind: "down,tab",
        title: "Next session",
        group: "Session",
        run: () => tabs.navigation.move(1),
      },
      { bind: "return", title: "Open session", group: "Session", run: () => tabs.navigation.select() },
      { bind: "space", title: "Mark session done", group: "Session", run: () => tabs.navigation.done() },
      { bind: "right,escape", title: "Return to prompt", group: "Session", run: leave },
    ],
  }))

  return (
    <box
      width={width()}
      height="100%"
      flexShrink={0}
      flexDirection="column"
      paddingRight={1}
      backgroundColor={theme.background.default}
    >
      <box height={3} flexShrink={0} paddingLeft={2} paddingRight={1} flexDirection="row" alignItems="center">
        <text flexGrow={1} fg={theme.text.default} attributes={TextAttributes.BOLD}>
          Sessions
        </text>
        <text
          fg={theme.text.subdued}
          onMouseUp={newSession}
          selectable={false}
        >
          opt+T
        </text>
      </box>
      <scrollbox
        ref={(value) => (scroll = value)}
        flexGrow={1}
        scrollAcceleration={getScrollAcceleration(config)}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background.default,
            foregroundColor: theme.scrollbar.default,
          },
        }}
      >
        <box flexShrink={0} paddingBottom={1}>
          <Show when={groups().length > 0} fallback={<text marginLeft={2} fg={theme.text.subdued}>No open sessions</text>}>
            <For each={groups()}>
              {(group) => (
                <box flexShrink={0}>
                  <box height={2} paddingLeft={2} paddingRight={1} alignItems="center" flexDirection="row">
                    <text flexGrow={1} fg={group.group === "running" ? accent() : theme.text.subdued}>
                      {labels[group.group]}
                    </text>
                    <text fg={theme.text.subdued}>{group.rows.length}</text>
                  </box>
                  <For each={group.rows}>
                    {(row) => (
                      <SessionInboxRow
                        row={row}
                        selected={tabs.current() === row.sessionID}
                        focused={tabs.navigation.active() && tabs.navigation.selected() === row.sessionID}
                        pendingDone={tabs.navigation.pendingDone() === row.sessionID}
                        number={numbers().get(row.sessionID)}
                        verb={activityVerb(row.sessionID, verbCycle())}
                        onSelect={() => {
                          tabs.navigation.blur()
                          tabs.select(row.sessionID)
                        }}
                      />
                    )}
                  </For>
                </box>
              )}
            </For>
          </Show>
        </box>
      </scrollbox>
      <box height={2} flexShrink={0} paddingLeft={2} alignItems="center">
        <text fg={theme.text.subdued} wrapMode="none" truncate>
          {tabs.navigation.active() ? "↑↓/tab choose · enter open · space done" : "← empty prompt · /tabs layout"}
        </text>
      </box>
    </box>
  )
}
