import type { LocationRef } from "@opencode/client"
import type { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo } from "solid-js"
import { SessionTurn } from "@opencode/util/session-turn"
import { useConfig } from "../../config"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useSessionTabs } from "../../context/session-tabs"
import type { ThinkingMode } from "../../context/thinking"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { createSingleFlight } from "../../util/single-flight"
import { createTimelineAnchors, groupID } from "./anchors"
import { defaultVerbosity, type GroupKind } from "./grouping/session"
import type { PendingAction, RenderContext } from "./render-context"
import { completeGroupBoundary, type SessionRow } from "./rows"

/** Runs after the next frame's layout and before it paints, unless the transcript was torn down. */
export function afterScrollLayout(scroll: () => ScrollBoxRenderable | undefined, continuation: () => void) {
  const view = scroll()
  if (!view || view.isDestroyed) return
  view.afterLayout(() => {
    if (!view.isDestroyed) continuation()
  })
}

// Pin an existing row before publication. Total height also counts streamed output below the
// reader, which must not move their viewport when it arrives alongside the older rows.
export function pinScrollAbove(scroll: () => ScrollBoxRenderable | undefined, skipID?: string) {
  const view = scroll()
  if (!view || view.isDestroyed) return
  if (view.stickyScroll && view.scrollTop >= view.scrollHeight - view.viewport.height) return
  const node = view
    .getChildren()
    .find(
      (child) =>
        (skipID === undefined || child.id !== skipID) && child.height > 0 && child.y + child.height > view.viewport.y,
    )
  if (node) afterScrollLayout(() => view, view.anchor(node))
}

export async function loadOlderMessages(input: {
  sessionID: string
  messages: Pick<ReturnType<typeof useData>["session"]["message"], "list" | "more" | "loadMore">
  rows: readonly SessionRow[]
  signal?: AbortSignal
  beforePublish?: () => void
  active: () => boolean
}) {
  const loadMore = () =>
    input.messages.loadMore(input.sessionID, {
      ...(input.signal ? { signal: input.signal } : {}),
      beforePublish: input.beforePublish,
    })
  await loadMore()
  await completeGroupBoundary({
    rows: input.rows,
    messages: () => input.messages.list(input.sessionID).length,
    more: () => input.messages.more(input.sessionID),
    loadMore,
    active: input.active,
  })
}

export function createPendingInbox(sessionID: string) {
  const client = useClient()
  const toast = useToast()
  const run = createSingleFlight<string>()

  // Uses the captured sessionID: after an await, the route may already name another tab, or none.
  const request = async (action: PendingAction, inboxID: string, failureLabel?: string) => {
    const call =
      action === "cancel"
        ? client.api.session.inbox.cancel({ sessionID, inboxID })
        : client.api.session.inbox.update({ sessionID, inboxID, delivery: action })
    const error = await call.then(
      () => undefined,
      (error) => error,
    )
    if (!error) return true
    const label = failureLabel ?? (action === "cancel" ? "delete" : action)
    toast.show({ title: `Failed to ${label} pending prompt`, message: errorMessage(error), variant: "error" })
    return false
  }

  const mutate = async (action: PendingAction, inboxID: string) =>
    (await run(inboxID, () => request(action, inboxID))) ?? false

  return { run, request, mutate }
}

export function createRenderContext(input: {
  sessionID: string
  rows: readonly SessionRow[]
  anchors: ReturnType<typeof createTimelineAnchors>
  scroll: () => ScrollBoxRenderable | undefined
  away: () => boolean
  width: () => number
  location?: () => LocationRef | undefined
  mutatePending: RenderContext["mutatePending"]
  onGroupToggle?: () => void
  openSession?: () => ((sessionID: string) => void) | undefined
}): RenderContext {
  const config = useConfig().data
  const data = useData()
  const sessionTabs = useSessionTabs()
  const dimensions = useTerminalDimensions()

  const messages = () => data.session.message.list(input.sessionID)
  const indexes = createMemo(() => new Map(messages().map((message, index) => [message.id, index])))
  const legacyTurns = createMemo(() => SessionTurn.legacy(messages()))
  const pending = createMemo(() => {
    const items = data.session.pending.list(input.sessionID)
    return new Map(items.flatMap((item) => (item.type === "user" ? [[item.id, item.delivery] as const] : [])))
  })
  const location = input.location ?? (() => data.session.get(input.sessionID)?.location)
  const models = createMemo(() => data.location.model.list(location()) ?? [])

  const thinkingMode = createMemo<ThinkingMode>(() => config.session?.thinking ?? "hide")
  const markdownMode = createMemo(() => config.session?.markdown ?? "rendered")
  const groupExploration = createMemo(() => config.session?.grouping !== "none")
  const diffWrapMode = createMemo(() => config.diffs?.wrap ?? "word")
  const verbosity = createMemo(() => config.session?.verbosity ?? defaultVerbosity)

  // Memoized per axis so width readers do not re-run on height-only resizes
  // (dimensions() is one object signal with identity equality) and vice versa.
  const terminalWidth = createMemo(() => dimensions().width)
  const terminalHeight = createMemo(() => dimensions().height)

  // High opens exploration and instruction summaries by default; everything else starts collapsed.
  const groupExpanded = (id: string, kind: GroupKind) =>
    sessionTabs.groupExpanded(input.sessionID, id) ??
    (verbosity() === "high" && (kind === "exploration" || kind === "instructions"))

  const setGroupExpanded = (id: string, expanded: boolean, anchor?: Renderable | null) => {
    // A group that ends the transcript would open off screen while the reader follows the bottom.
    const last = input.rows.findLast((row) => row.type !== "assistant-footer" && row.type !== "turn-usage")
    const ending = last?.type === "group" && groupID(last, 0) === id
    const view = input.scroll()
    // Keeps the toggled disclosure's header on its viewport row through the next layout.
    if (view && anchor && (input.away() || !ending)) afterScrollLayout(() => view, view.anchor(anchor))
    sessionTabs.setGroupExpanded(input.sessionID, id, expanded)
    input.onGroupToggle?.()
  }

  return {
    get width() {
      return input.width()
    },
    terminal: {
      get width() {
        return terminalWidth()
      },
      get height() {
        return terminalHeight()
      },
    },
    sessionID: input.sessionID,
    anchors: input.anchors,
    groupExpanded,
    setGroupExpanded,
    thinkingMode,
    markdownMode,
    groupExploration,
    diffWrapMode,
    models,
    messageIndex: (id) => indexes().get(id),
    legacyTurns,
    config,
    mutatePending: input.mutatePending,
    pendingDelivery: (id) => pending().get(id),
    get openSession() {
      return input.openSession?.()
    },
  }
}
