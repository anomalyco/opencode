import type { SessionTranscriptInput } from "@opencode/plugin/tui/context"
import { MouseButton, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useConfig } from "../../config"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { Keymap } from "../../context/keymap"
import { useSessionTabs } from "../../context/session-tabs"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { getScrollAcceleration } from "../../util/scroll"
import { createTimelineAnchors } from "./anchors"
import { SessionRowView } from "./index"
import { context } from "./render-context"
import { createSessionRows, messageBoundaryIDs } from "./rows"
import { createPendingInbox, createRenderContext, loadOlderMessages, pinScrollAbove } from "./shared"

export function SessionTranscript(props: SessionTranscriptInput) {
  return (
    <Show keyed when={props.sessionID}>
      {(sessionID) => <Transcript {...props} sessionID={sessionID} />}
    </Show>
  )
}

function Transcript(props: SessionTranscriptInput) {
  const sessionID = props.sessionID
  const tabs = useSessionTabs()
  onCleanup(tabs.retain(sessionID))

  const config = useConfig().data
  const client = useClient()
  const data = useData()
  const renderer = useRenderer()
  const terminal = useTerminalDimensions()
  const theme = useTheme()
  const toast = useToast()
  const [away, setAway] = createSignal(false)
  const [scroll, setScroll] = createSignal<ScrollBoxRenderable>()
  const showScrollbar = () => config.session?.scrollbar ?? false
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))

  const pinAbove = () => pinScrollAbove(scroll, "transcript-older")
  const anchors = createTimelineAnchors()
  const rows = createSessionRows(() => sessionID, undefined, pinAbove)
  const messages = () => data.session.message.list(sessionID)
  const message = (messageID: string) => data.session.message.get(sessionID, messageID)
  const boundaries = createMemo(() => messageBoundaryIDs(rows, messages()))
  const location = () => data.session.get(sessionID)?.location
  createEffect(() => {
    if (client.connection.status() !== "connected") return
    void data.session.sync(sessionID).catch(() => undefined)
    void data.session.permission.sync(sessionID).catch(() => undefined)
  })
  createEffect(() => {
    if (client.connection.status() !== "connected") return
    const ref = location()
    if (ref) void data.location.model.sync(ref).catch(() => undefined)
  })

  const pendingInbox = createPendingInbox(sessionID)

  const more = () => data.session.message.more(sessionID)
  const history = new AbortController()
  onCleanup(() => history.abort())
  function loadOlder() {
    if (!more() || data.session.message.loading(sessionID)) return
    void loadOlderMessages({
      sessionID,
      messages: data.session.message,
      rows,
      signal: history.signal,
      beforePublish: pinAbove,
      active: () => !history.signal.aborted,
    }).catch(toast.error)
  }

  const jumpToLatest = () => scroll()?.scrollTo(Infinity)
  Keymap.createLayer(() => ({
    mode: "global",
    target: scroll,
    enabled: () => scroll() !== undefined,
    commands: [
      { bind: "ctrl+end", run: jumpToLatest },
      {
        bind: "up,pageup,home",
        run: () => {
          if (scroll()?.scrollTop === 0) loadOlder()
          return false
        },
      },
    ],
  }))

  function updateAway() {
    const view = scroll()
    if (!view || view.isDestroyed) return
    setAway(view.scrollTop < view.scrollHeight - view.viewport.height)
  }

  const renderContext = createRenderContext({
    sessionID,
    rows,
    anchors,
    scroll,
    away,
    width: () => Math.max(1, (props.width ?? terminal().width) - (showScrollbar() ? 2 : 0)),
    location,
    mutatePending: pendingInbox.mutate,
    openSession: () => props.onOpenSession,
  })

  return (
    <context.Provider value={renderContext}>
      <box flexGrow={1} flexBasis={0} minHeight={0} minWidth={0}>
        <scrollbox
          ref={setScroll}
          flexGrow={1}
          flexBasis={0}
          minHeight={0}
          stickyScroll
          stickyStart="bottom"
          scrollAcceleration={scrollAcceleration()}
          viewportOptions={{ paddingRight: showScrollbar() ? 1 : 0, onSizeChange: updateAway }}
          // The scroll offset can stay unchanged as new content moves the bottom away from it.
          contentOptions={{ onSizeChange: updateAway }}
          verticalScrollbarOptions={{
            paddingLeft: 1,
            visible: showScrollbar(),
            onChange: updateAway,
            trackOptions: {
              backgroundColor: theme.decrease(theme.background.raised.base),
              foregroundColor: theme.border.base,
            },
          }}
          onMouseDown={(event) => {
            if (event.button !== MouseButton.LEFT || !props.onActivate) return
            // Presses on a scrollbar are handled on the scrollbox itself and don't bubble to the panel.
            props.onActivate()
            event.stopPropagation()
            if (!renderer.hasSelection) scroll()?.focus()
          }}
          onMouseScroll={(event) => {
            if (event.scroll?.direction === "up" && scroll()?.scrollTop === 0) loadOlder()
          }}
        >
          <Show when={more()}>
            <box id="transcript-older" paddingLeft={1} flexShrink={0} onMouseUp={loadOlder}>
              <text fg={theme.text.action.secondary.base} selectable={false}>
                Load older messages ↑
              </text>
            </box>
          </Show>
          <For each={rows}>
            {(row, index) => <SessionRowView row={row} message={message} boundaryID={boundaries()[index()]} />}
          </For>
        </scrollbox>
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="flex-end">
          <Show when={away()}>
            <box onMouseUp={jumpToLatest}>
              <text fg={theme.text.action.secondary.base} selectable={false}>
                Jump to latest ↓
              </text>
            </box>
          </Show>
        </box>
      </box>
    </context.Provider>
  )
}
