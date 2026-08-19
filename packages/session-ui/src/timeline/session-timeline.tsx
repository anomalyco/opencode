import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client/promise"
import { Card } from "@opencode-ai/ui/card"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { For, Show, createMemo, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import {
  SessionAssistantContent,
  SessionContextToolGroup,
  MessageDivider,
  SessionShellMessage,
  SessionUserMessage,
  currentContentDefaultOpen,
  type SessionUserActions,
  type SessionUserComment,
} from "../message/current-message"
import { SessionRetry } from "../components/session-retry"
import { createReactiveTimelineProjection, Timeline, TimelineRow } from "./projection"

const emptyAssistantMessages: SessionMessageAssistant[] = []
type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, TimelineRow.TurnGap>
type TimelineRowByTag<Tag extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: Tag }>

export type SessionUserPresentation = {
  displayText?: string
  comments?: SessionUserComment[]
}

export type SessionTimelineProps = {
  document: SessionDocument
  presentation?: Record<string, SessionUserPresentation | undefined>
  actions?: SessionUserActions
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  class?: string
}

export function SessionTimeline(props: SessionTimelineProps) {
  const i18n = useI18n()
  const projection = createReactiveTimelineProjection({
    sessionMessages: () => props.document.messages,
    status: () => props.document.status,
    showReasoningSummaries: () => props.showReasoningSummaries ?? true,
  })
  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>({})
  const workingTurn = (messageID: string) =>
    props.document.status.type !== "idle" && projection.activeMessageID() === messageID
  const duration = (messageID: string) => {
    const user = projection.messageByID().get(messageID)
    if (user?.type !== "user") return undefined
    const completed = (projection.assistantMessagesByParent().get(messageID) ?? emptyAssistantMessages).reduce<
      number | undefined
    >((latest, message) => {
      if (message.time.completed === undefined) return latest
      return latest === undefined ? message.time.completed : Math.max(latest, message.time.completed)
    }, undefined)
    if (completed === undefined || completed < user.time.created) return undefined
    return completed - user.time.created
  }
  const copyContentID = (messageID: string) => {
    if (workingTurn(messageID)) return null
    const messages = projection.assistantMessagesByParent().get(messageID) ?? emptyAssistantMessages
    return messages
      .toReversed()
      .flatMap((message) => Timeline.contentEntries(message).toReversed())
      .find((entry) => entry.content.type === "text" && !!entry.content.text.trim())?.id
  }

  const renderAssistant = (row: Accessor<TimelineRow.AssistantPart>) => {
    const group = row().group
    if (group.type === "context") {
      const tools = createMemo(() => {
        const current = row().group
        if (current.type !== "context") return []
        return current.refs.flatMap((ref) => {
          const message = projection.messageByID().get(ref.messageID)
          const content = Timeline.resolveContent(message, ref.partID)
          return message?.type === "assistant" && content?.type === "tool"
            ? [{ message, content, contentID: ref.partID }]
            : []
        })
      })
      const key = () => `context:${row().group.key}`
      return (
        <SessionContextToolGroup
          sessionID={props.document.sessionID}
          tools={tools()}
          open={toolOpen[key()] === true}
          busy={
            workingTurn(row().userMessageID) &&
            projection.lastAssistantGroupKey().get(row().userMessageID) === row().group.key
          }
          onOpenChange={(open) => setToolOpen(key(), open)}
        />
      )
    }

    const ref = createMemo(() => {
      const current = row().group
      return current.type === "part" ? current.ref : undefined
    })
    const message = createMemo(() => {
      const current = ref()
      return current ? projection.messageByID().get(current.messageID) : undefined
    })
    const assistant = createMemo(() => {
      const current = message()
      return current?.type === "assistant" ? current : undefined
    })
    const content = createMemo(() => {
      const current = ref()
      return current ? Timeline.resolveContent(message(), current.partID) : undefined
    })
    const defaultOpen = createMemo(() => {
      const current = message()
      const item = content()
      if (current?.type !== "assistant" || !item) return undefined
      return currentContentDefaultOpen(
        props.document.sessionID,
        current,
        item,
        ref()!.partID,
        props.shellToolDefaultOpen ?? false,
        props.editToolDefaultOpen ?? false,
      )
    })
    return (
      <Show when={assistant()}>
        {(message) => (
          <Show when={content()}>
            {(content) => (
              <SessionAssistantContent
                sessionID={props.document.sessionID}
                parentID={row().userMessageID}
                message={message()}
                content={content()}
                contentID={ref()!.partID}
                showAssistantCopyPartID={copyContentID(row().userMessageID)}
                turnDurationMs={duration(row().userMessageID)}
                useV2Actions
                defaultOpen={defaultOpen()}
                toolOpen={toolOpen[row().group.key] ?? defaultOpen()}
                onToolOpenChange={(open) => setToolOpen(row().group.key, open)}
              />
            )}
          </Show>
        )}
      </Show>
    )
  }

  const notice = (message: SessionMessageInfo) => {
    if (message.type === "agent-switched")
      return {
        label: i18n.t("ui.tool.agent.default"),
        data: message.previous ? `${message.previous} -> ${message.agent}` : message.agent,
      }
    if (message.type === "model-switched")
      return {
        label: i18n.t("ui.sessionTimeline.notice.model"),
        data: `${message.model.providerID}/${message.model.id}`,
      }
    if (message.type === "location-switched")
      return { label: i18n.t("ui.patch.action.moved"), data: message.location.directory }
    if (message.type === "skill") return { label: i18n.t("ui.tool.skill"), data: message.name }
    if (message.type === "system") return { label: message.description ?? message.text }
    if (message.type === "compaction") return { label: i18n.t("ui.messagePart.compaction"), data: message.status }
    if (message.type === "synthetic") return { label: message.description ?? message.text }
    return undefined
  }

  const render = (row: Accessor<TimelineRow.TimelineRow>) => {
    if (row()._tag === "TurnGap") return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
    if (row()._tag === "UserMessage") {
      const current = row as Accessor<TimelineRowByTag<"UserMessage">>
      const message = createMemo(() => {
        const value = projection.messageByID().get(current().userMessageID)
        return value?.type === "user" ? value : undefined
      })
      const context = createMemo(() => projection.userContextByID().get(current().userMessageID))
      return (
        <Frame row={current()}>
          <Show when={message()}>
            {(message) => (
              <SessionUserMessage
                sessionID={props.document.sessionID}
                message={message()}
                displayText={props.presentation?.[message().id]?.displayText}
                comments={props.presentation?.[message().id]?.comments}
                historicalAgent={context()?.agent ?? ""}
                historicalModel={context()?.model ?? { id: "", providerID: "" }}
                actions={props.actions}
                useV2Actions
              />
            )}
          </Show>
        </Frame>
      )
    }
    if (row()._tag === "Shell") {
      const current = row as Accessor<TimelineRowByTag<"Shell">>
      const message = createMemo(() => {
        const value = projection.messageByID().get(current().messageID)
        return value?.type === "shell" ? value : undefined
      })
      return (
        <Frame row={current()}>
          <Show when={message()}>
            {(message) => (
              <SessionShellMessage
                message={message()}
                defaultOpen={props.shellToolDefaultOpen}
                open={toolOpen[message().id]}
                onOpenChange={(open) => setToolOpen(message().id, open)}
              />
            )}
          </Show>
        </Frame>
      )
    }
    if (row()._tag === "Notice") {
      const current = row as Accessor<TimelineRowByTag<"Notice">>
      const content = createMemo(() => {
        const message = projection.messageByID().get(current().messageID)
        return message ? notice(message) : undefined
      })
      return (
        <Frame row={current()}>
          <Show when={content()}>
            {(content) => (
              <div data-slot="session-timeline-notice" class="w-full pt-3 pb-1 text-13-regular text-text-weak">
                <bdi dir="auto" class="text-13-medium">
                  {content().label}
                </bdi>
                <Show when={content().data}>
                  {(data) => (
                    <span>
                      {" "}
                      {"\u00B7"} <bdi dir="auto">{data()}</bdi>
                    </span>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Frame>
      )
    }
    if (row()._tag === "TurnDivider")
      return (
        <Frame row={row() as TimelineRowByTag<"TurnDivider">}>
          <MessageDivider label={i18n.t("ui.message.interrupted")} />
        </Frame>
      )
    if (row()._tag === "AssistantPart") {
      const current = row as Accessor<TimelineRowByTag<"AssistantPart">>
      return (
        <Frame row={current()}>
          <div data-slot="session-turn-assistant-content" aria-hidden={workingTurn(current().userMessageID)}>
            {renderAssistant(current)}
          </div>
        </Frame>
      )
    }
    if (row()._tag === "Thinking") {
      const current = row as Accessor<TimelineRowByTag<"Thinking">>
      return (
        <Frame row={current()}>
          <div data-slot="session-turn-thinking">
            <TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />
            <Show when={!props.showReasoningSummaries}>
              <TextReveal
                text={current().reasoningHeading}
                class="session-turn-thinking-heading"
                travel={25}
                duration={700}
              />
            </Show>
          </div>
        </Frame>
      )
    }
    if (row()._tag === "Retry") {
      const current = row as Accessor<TimelineRowByTag<"Retry">>
      const status = createMemo(() => {
        const retry = (
          projection.assistantMessagesByParent().get(current().userMessageID) ?? emptyAssistantMessages
        ).at(-1)?.retry
        if (!retry) return props.document.status
        return { type: "retry" as const, attempt: retry.attempt, message: retry.error.message, next: retry.at }
      })
      return (
        <Frame row={current()}>
          <SessionRetry status={status()} show={projection.activeMessageID() === current().userMessageID} />
        </Frame>
      )
    }
    const current = row as Accessor<TimelineRowByTag<"Error">>
    return (
      <Frame row={current()}>
        <Card variant="error" class="error-card">
          {current().text}
        </Card>
      </Frame>
    )
  }

  const rowKeys = createMemo(() => projection.rows().map(TimelineRow.key))

  function Row(props: { rowKey: string }) {
    const initial = projection.rowByKey().get(props.rowKey)!
    const row = createMemo(() => projection.rowByKey().get(props.rowKey) ?? initial)
    return render(row)
  }

  return (
    <div data-component="session-timeline" class={props.class}>
      <For each={rowKeys()}>{(rowKey) => <Row rowKey={rowKey} />}</For>
    </div>
  )
}

function Frame(props: { row: FramedTimelineRow; children: JSX.Element }) {
  return (
    <div
      data-message-id={props.row.userMessageID}
      data-timeline-row={props.row._tag}
      classList={{
        "min-w-0 w-full max-w-full": true,
        "pt-3": props.row._tag === "AssistantPart" && props.row.previousAssistantPart,
      }}
    >
      <div data-component="session-turn" class="min-w-0 w-full relative px-4 md:px-5">
        {props.children}
      </div>
    </div>
  )
}
