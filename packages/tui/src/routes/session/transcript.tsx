import type { SessionTranscriptInput } from "@opencode/plugin/tui/context"
import { MouseButton, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { SessionTurn } from "@opencode/util/session-turn"
import { useConfig } from "../../config"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { Keymap } from "../../context/keymap"
import { useSessionTabs } from "../../context/session-tabs"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { getScrollAcceleration } from "../../util/scroll"
import { createSingleFlight } from "../../util/single-flight"
import { createTimelineAnchors, groupID } from "./anchors"
import { defaultVerbosity } from "./grouping/session"
import { SessionRowView } from "./index"
import { context, type PendingAction, type RenderContext } from "./render-context"
import { completeGroupBoundary, createSessionRows, messageBoundaryIDs } from "./rows"

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

  const anchors = createTimelineAnchors()
  const rows = createSessionRows(() => sessionID, undefined, pinAbove)
  const messages = () => data.session.message.list(sessionID)
  const indexes = createMemo(() => new Map(messages().map((message, index) => [message.id, index])))
  const message = (messageID: string) => data.session.message.get(sessionID, messageID)
  const boundaries = createMemo(() => messageBoundaryIDs(rows, messages()))
  const legacyTurns = createMemo(() => SessionTurn.legacy(messages()))
  const pending = createMemo(
    () => new Map(data.session.pending.list(sessionID).map((item) => [item.id, item.delivery])),
  )
  const location = () => data.session.get(sessionID)?.location
  const models = createMemo(() => data.location.model.list(location()) ?? [])
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

  const runPendingAction = createSingleFlight<string>()
  const mutatePending = async (action: PendingAction, inboxID: string) =>
    (await runPendingAction(inboxID, async () => {
      const request =
        action === "cancel"
          ? client.api.session.inbox.cancel({ sessionID, inboxID })
          : client.api.session.inbox.update({ sessionID, inboxID, delivery: action })
      return request.then(
        () => true,
        (error) => {
          toast.error(error)
          return false
        },
      )
    })) ?? false

  const more = () => data.session.message.more(sessionID)
  const history = new AbortController()
  onCleanup(() => history.abort())
  function loadOlder() {
    if (!more() || data.session.message.loading(sessionID)) return
    const loadMore = () => data.session.message.loadMore(sessionID, { signal: history.signal, beforePublish: pinAbove })
    void (async () => {
      await loadMore()
      await completeGroupBoundary({
        rows,
        messages: () => messages().length,
        more,
        loadMore,
        active: () => !history.signal.aborted,
      })
    })().catch(toast.error)
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

  function pinAbove() {
    const view = scroll()
    if (!view || view.isDestroyed || view.scrollTop >= view.scrollHeight - view.viewport.height) return
    const row = view
      .getChildren()
      .find((node) => node.id !== "transcript-older" && node.height > 0 && node.y + node.height > view.viewport.y)
    if (row) view.afterLayout(view.anchor(row))
  }

  const renderContext: RenderContext = {
    get width() {
      return Math.max(1, (props.width ?? terminal().width) - (showScrollbar() ? 2 : 0))
    },
    get terminal() {
      return terminal()
    },
    sessionID,
    anchors,
    groupExpanded: (id, kind) =>
      tabs.groupExpanded(sessionID, id) ??
      ((config.session?.verbosity ?? defaultVerbosity) === "high" &&
        (kind === "exploration" || kind === "instructions")),
    setGroupExpanded: (id, expanded, anchor) => {
      const last = rows.findLast((row) => row.type !== "assistant-footer" && row.type !== "turn-usage")
      const ending = last?.type === "group" && groupID(last, 0) === id
      const view = scroll()
      if (view && anchor && (away() || !ending)) view.afterLayout(view.anchor(anchor))
      tabs.setGroupExpanded(sessionID, id, expanded)
    },
    thinkingMode: () => config.session?.thinking ?? "hide",
    markdownMode: () => config.session?.markdown ?? "rendered",
    groupExploration: () => config.session?.grouping !== "none",
    diffWrapMode: () => config.diffs?.wrap ?? "word",
    models,
    messageIndex: (id) => indexes().get(id),
    legacyTurns,
    config,
    mutatePending,
    pendingDelivery: (id) => pending().get(id),
    get openSession() {
      return props.onOpenSession
    },
  }

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
