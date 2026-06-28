import {
  createEffect,
  createMemo,
  createResource,
  For,
  Index,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import type {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
import { Card } from "@opencode-ai/ui/card"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import {
  ContextToolGroup,
  Message,
  MessageDivider,
  Part as MessagePart,
  partDefaultOpen,
} from "@opencode-ai/session-ui/message-part"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import type { SessionTab } from "@/context/tabs"
import { same } from "@/utils/same"
import { sessionTitle } from "@/utils/session-title"
import { getFilename } from "@opencode-ai/core/util/path"
import { MessageComment, Timeline, TimelineRow, type TimelineRowMap } from "./timeline/rows"
import { TimelineDiffSummaryRow } from "./timeline/message-timeline"

const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const emptyAssistantMessages: AssistantMessage[] = []
const idle = { type: "idle" as const }

type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "TurnGap" }>
type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>

export function SessionTextPane(props: { tab: SessionTab; centered?: boolean }) {
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const language = useLanguage()
  const settings = useSettings()
  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>({})
  const [session] = createResource(
    () => props.tab.sessionId,
    (sessionID) =>
      serverSDK()
        .client.session.get({ sessionID })
        .then((result) => result.data)
        .catch(() => undefined),
  )
  const directory = createMemo(() => session()?.directory)
  const sync = createMemo(() => {
    const dir = directory()
    if (!dir) return
    return serverSync().ensureDirSyncContext(dir)
  })
  const messages = createMemo(
    () => sync()?.data.message[props.tab.sessionId] ?? emptyMessages,
    emptyMessages,
    { equals: same },
  )
  const loaded = createMemo(() => sync()?.data.message[props.tab.sessionId] !== undefined)
  const title = createMemo(() => sessionTitle(session()?.title ?? sync()?.session.get(props.tab.sessionId)?.title))
  const sessionStatus = createMemo(() => sync()?.data.session_status[props.tab.sessionId] ?? idle)
  const userMessages = createMemo(
    () => messages().filter((message): message is UserMessage => message.role === "user"),
    [] as UserMessage[],
    { equals: same },
  )
  const messageByID = createMemo(() => new Map(messages().map((message) => [message.id, message] as const)))
  const assistantMessagesByParent = createMemo(() =>
    messages().reduce((result, message) => {
      if (message.role !== "assistant" || !message.parentID) return result
      result.set(message.parentID, [...(result.get(message.parentID) ?? emptyAssistantMessages), message])
      return result
    }, new Map<string, AssistantMessage[]>()),
  )
  const getMsgParts = (messageID: string) => sync()?.data.part[messageID] ?? emptyParts
  const getMsgPart = (messageID: string, partID: string) =>
    getMsgParts(messageID).find((part) => part.id === partID)
  const rows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) => {
    const next = userMessages().flatMap((message, index) =>
      Timeline.constructMessageRows(
        message,
        getMsgParts,
        assistantMessagesByParent().get(message.id) ?? emptyAssistantMessages,
        index,
        settings.general.showReasoningSummaries(),
        sessionStatus().type,
        false,
      ),
    )
    if (!previous || previous.length !== next.length) return next
    if (!previous.every((item, index) => TimelineRow.equals(item, next[index]!))) return next
    return previous
  })
  const autoScroll = createAutoScroll({
    working: loaded,
    bottomThreshold: 8,
  })

  createEffect(() => {
    const ctx = sync()
    if (!ctx) return
    void ctx.session.sync(props.tab.sessionId).catch(() => {})
  })

  const turnDurationMs = (userMessageID: string) => {
    const message = messageByID().get(userMessageID)
    if (!message || message.role !== "user") return
    const end = (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages).reduce<number | undefined>(
      (max, item) => {
        const completed = item.time.completed
        if (typeof completed !== "number") return max
        if (max === undefined) return completed
        return Math.max(max, completed)
      },
      undefined,
    )
    if (typeof end !== "number" || end < message.time.created) return
    return end - message.time.created
  }

  const assistantCopyPartID = (userMessageID: string) =>
    (assistantMessagesByParent().get(userMessageID) ?? emptyAssistantMessages)
      .slice()
      .reverse()
      .flatMap((message) => getMsgParts(message.id).slice().reverse())
      .find((part) => part.type === "text" && !!part.text?.trim())?.id ?? null

  const renderAssistantPartGroup = (row: Accessor<TimelineRowMap["AssistantPart"]>) => {
    if (row().group.type === "context") {
      const parts = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return emptyTools
        return group.refs
          .map((ref) => getMsgPart(ref.messageID, ref.partID))
          .filter((part): part is ToolPart => part?.type === "tool")
      })

      return <ContextToolGroup parts={parts()} />
    }

    const message = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const part = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })
    const defaultOpen = createMemo(() => {
      const item = part()
      if (!item) return
      return partDefaultOpen(item, settings.general.shellToolPartsExpanded(), settings.general.editToolPartsExpanded())
    })

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={part()}>
            {(part) => (
              <MessagePart
                part={part()}
                message={message()}
                showAssistantCopyPartID={assistantCopyPartID(row().userMessageID)}
                turnDurationMs={turnDurationMs(row().userMessageID)}
                defaultOpen={defaultOpen()}
                toolOpen={toolOpen[part().id] ?? defaultOpen()}
                onToolOpenChange={(open) => setToolOpen(part().id, open)}
                deferToolContent={false}
                virtualizeDiff={false}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  function TimelineRowFrame(input: { row: Accessor<FramedTimelineRow>; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row()
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousAssistantPart = () => {
      const row = input.row()
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        data-message-id={anchor() ? input.row().userMessageID : undefined}
        data-timeline-row={input.row()._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": !!props.centered,
          "md:mx-auto": !!props.centered,
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: Accessor<TimelineRow.TimelineRow>) => {
    switch (row()._tag) {
      case "TurnGap":
        return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
      case "CommentStrip": {
        const commentStripRow = row as Accessor<TimelineRowByTag<"CommentStrip">>
        const comments = createMemo(() =>
          getMsgParts(commentStripRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={commentStripRow}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-text-weak">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const item = messageByID().get(userMessageRow().userMessageID)
          if (item?.role === "user") return item
        })
        return (
          <TimelineRowFrame row={userMessageRow}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message message={message()} parts={getMsgParts(userMessageRow().userMessageID)} />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        const turnDividerRow = row as Accessor<TimelineRowByTag<"TurnDivider">>
        return (
          <TimelineRowFrame row={turnDividerRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    turnDividerRow().label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-assistant-content">{renderAssistantPartGroup(assistantPartRow)}</div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "DiffSummary": {
        const diffSummaryRow = row as Accessor<TimelineRowByTag<"DiffSummary">>
        return (
          <TimelineRowFrame row={diffSummaryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <TimelineDiffSummaryRow diffs={diffSummaryRow().diffs} />
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <Card variant="error" class="error-card">
                {errorRow().text}
              </Card>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking":
      case "Retry":
        return null
    }
  }

  function TimelineRowView(input: { row: TimelineRow.TimelineRow }) {
    return renderTimelineRow(() => input.row)
  }

  return (
    <div
      class="relative size-full min-w-0 overflow-x-hidden overflow-y-auto"
      ref={autoScroll.scrollRef}
      onScroll={autoScroll.handleScroll}
      onPointerDown={autoScroll.handleInteraction}
      style={{ "--sticky-accordion-top": "48px" }}
    >
      <div class="min-w-0 w-full max-w-full overflow-x-hidden" ref={autoScroll.contentRef}>
        <div
          data-session-title
          classList={{
            "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--background-stronger)_48px,transparent)]": true,
            "w-full pb-4": true,
          }}
        >
          <div
            classList={{
              "h-12 w-full flex items-center justify-between gap-2 pl-2 pr-3 md:pl-4 md:pr-3": true,
              "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": !!props.centered,
            }}
          >
            <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
              <div class="flex items-center min-w-0 grow-1">
                <h1 class="min-w-0 grow truncate text-14-medium text-text-strong">
                  {title() ?? language.t("session.tab.session")}
                </h1>
              </div>
            </div>
          </div>
        </div>
        <Show
          when={loaded()}
          fallback={<div class="px-4 py-3 text-12-regular text-text-weak">{language.t("common.loading")}...</div>}
        >
          <For each={rows()}>{(row) => <TimelineRowView row={row} />}</For>
          <div aria-hidden="true" class="h-16" />
        </Show>
      </div>
    </div>
  )
}
