import { createEffect, createMemo } from "solid-js"
import { createSessionOwnership } from "./session-ownership"
import { selectSessionUserMessages, selectVisibleSessionUserMessages } from "./session-domain"
import type { SessionModel } from "./model"
import { MessageTimeline } from "./timeline/message-timeline"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"

export function SubagentPanel(props: { session: SessionModel; sessionID: string }) {
  const data = props.session.shared.data
  const id = () => props.sessionID
  const sessionKey = () =>
    SessionStateKey.from(
      SessionStateKey.scope(props.session.identity.workspaceKey()),
      SessionRouteKey.fromRoute(SessionStateKey.route(props.session.identity.workspaceKey()), id()),
    )
  const messages = createMemo(() => data.session.message.list(id()))
  const userMessages = createMemo(() => selectSessionUserMessages(messages()))
  const visibleUserMessages = createMemo(() =>
    selectVisibleSessionUserMessages(userMessages(), data.session.get(id())?.revert?.messageID),
  )
  const identity = {
    params: {
      ...props.session.identity.params,
      get id() {
        return id()
      },
    },
    sessionID: id,
    sessionKey,
    workspaceKey: props.session.identity.workspaceKey,
  }
  const source = {
    identity,
    data: {
      info: createMemo(() => data.session.get(id())),
      parent: createMemo(() => {
        const parentID = data.session.get(id())?.parentID
        return parentID ? data.session.get(parentID) : undefined
      }),
      parentID: createMemo(() => data.session.get(id())?.parentID),
      status: createMemo(() =>
        data.session.status(id()) === "running" ? ({ type: "busy" } as const) : ({ type: "idle" } as const),
      ),
    },
    history: {
      messages,
      userMessages,
      visibleUserMessages,
      lastUserMessage: createMemo(() => visibleUserMessages().at(-1)),
    },
    ownership: createSessionOwnership(sessionKey),
  }
  const timeline = createSessionTimelineInteraction(source)

  createEffect(() => {
    const sessionID = id()
    void Promise.all([
      data.session.sync(sessionID),
      data.session.message.sync(sessionID),
      data.session.pending.sync(sessionID),
    ]).catch(() => undefined)
  })

  return (
    <div class="size-full min-h-0 overflow-hidden">
      <MessageTimeline
        active
        hideHeader
        session={source}
        background={{ blocking: () => [], tasks: () => [], move: async () => {} }}
        scroll={timeline.scroll}
        onResumeScroll={timeline.actions.resume}
        setScrollRef={timeline.view.setScrollRef}
        onScheduleScrollState={timeline.view.scheduleScrollState}
        onPin={timeline.view.pin}
        onUnpin={timeline.view.unpin}
        onUserScroll={timeline.view.markUserScroll}
        onHistoryScroll={timeline.view.onHistoryScroll}
        onSelectionInteraction={timeline.view.selectionInteraction}
        pinned={timeline.view.pinned()}
        centered={false}
        reserveReviewToggle={false}
        setContentRef={timeline.view.setContentRef}
        diffs={() => undefined}
        onReview={() => {}}
        workspaceMoveEligible={false}
        onSummaryOpenChange={() => {}}
        anchor={timeline.view.anchor}
        setRevealMessage={timeline.view.setRevealMessage}
        setScrollToEnd={timeline.view.setScrollToEnd}
      />
    </div>
  )
}
