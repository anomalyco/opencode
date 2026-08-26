import type {
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
} from "@opencode-ai/client/promise"
import { Card } from "@opencode-ai/ui/card"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { TextReveal } from "@opencode-ai/ui/text-reveal"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { For, Show, createMemo, type Accessor, type JSX } from "solid-js"
import type { SessionUserActions, SessionUserComment } from "../actions"
import { BasicTool } from "../components/basic-tool"
import { useData } from "../context"
import { TimelineSeparator } from "../components/timeline-separator"
import {
  SessionAssistantContent,
  SessionContextToolGroup,
  SessionFileToolGroup,
  SessionShellMessage,
  SessionUserMessage,
  currentContentDefaultOpen,
} from "../message/current-message"
import { SessionCompactionMessage } from "../message/message-content"
import { SessionRetry } from "../components/session-retry"
import { createReactiveTimelineProjection, Timeline, TimelineRow, unwrapErrorMessage } from "./projection"

const emptyAssistantMessages: SessionMessageAssistant[] = []
type Projection = ReturnType<typeof createReactiveTimelineProjection>
type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, TimelineRow.TurnGap>

export type SessionUserPresentation = {
  displayText?: string
  comments?: SessionUserComment[]
}

export function createSessionTimelineRowRenderer(input: {
  sessionID: Accessor<string>
  status: Accessor<SessionStatus>
  projection: Projection
  presentation: (message: SessionMessageUser) => SessionUserPresentation | undefined
  actions?: SessionUserActions
  showReasoningSummaries: Accessor<boolean>
  shellToolDefaultOpen: Accessor<boolean>
  editToolDefaultOpen: Accessor<boolean>
  disclosure: {
    value: (key: string) => boolean | undefined
    set: (key: string, open: boolean) => void
  }
  centered?: Accessor<boolean>
  padding?: Accessor<string>
  anchor?: (messageID: string) => string | undefined
}) {
  const i18n = useI18n()
  const data = useData()
  const workingTurn = (messageID: string) =>
    input.status().type !== "idle" && input.projection.activeMessageID() === messageID
  const duration = (messageID: string) => {
    const user = input.projection.messageByID().get(messageID)
    if (user?.type !== "user") return null
    const completed = (input.projection.assistantMessagesByParent().get(messageID) ?? emptyAssistantMessages).reduce<
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
    return (input.projection.assistantMessagesByParent().get(messageID) ?? emptyAssistantMessages)
      .toReversed()
      .flatMap((message) => Timeline.contentEntries(message).toReversed())
      .find((entry) => entry.content.type === "text" && !!entry.content.text.trim())?.id
  }
  const padding = () => input.padding?.() ?? "px-4 md:px-5"

  const renderAssistant = (row: Accessor<TimelineRow.AssistantPart>, onSizeChange?: () => void) => {
    if (row().group.type === "context") {
      const tools = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return []
        return group.refs.flatMap((ref) => {
          const message = input.projection.messageByID().get(ref.messageID)
          const content = Timeline.resolveContent(message, ref.partID)
          return message?.type === "assistant" && content?.type === "tool" ? [content] : []
        })
      })
      const key = () => `context:${row().group.key}`
      return (
        <SessionContextToolGroup
          tools={tools()}
          open={input.disclosure.value(key()) === true}
          busy={
            workingTurn(row().userMessageID) &&
            input.projection.lastAssistantGroupKey().get(row().userMessageID) === row().group.key
          }
          onOpenChange={(open) => input.disclosure.set(key(), open)}
          onSizeChange={onSizeChange}
        />
      )
    }

    if (row().group.type === "file") {
      const tools = createMemo(() => {
        const group = row().group
        if (group.type !== "file") return []
        return group.refs.flatMap((ref) => {
          const message = input.projection.messageByID().get(ref.messageID)
          const content = Timeline.resolveContent(message, ref.partID)
          return message?.type === "assistant" && content?.type === "tool" ? [content] : []
        })
      })
      const firstPath = createMemo(() => {
        const tool = tools()[0]
        if (!tool || !("metadata" in tool.state)) return undefined
        const files = tool.state.metadata?.files
        if (!Array.isArray(files)) return undefined
        const file = files[0]
        return file && typeof file === "object" && "file" in file && typeof file.file === "string"
          ? file.file
          : undefined
      })
      return (
        <SessionFileToolGroup
          tools={tools()}
          fileOpen={(path) => {
            const open = input.disclosure.value(`${row().group.key}:file:${path}`)
            if (open !== undefined) return open
            if (tools()[0]?.name !== "edit" || path !== firstPath()) return false
            return input.disclosure.value(row().group.key) ?? input.editToolDefaultOpen()
          }}
          onFileOpenChange={(path, open) => input.disclosure.set(`${row().group.key}:file:${path}`, open)}
          onSizeChange={onSizeChange}
        />
      )
    }

    const ref = createMemo(() => {
      const group = row().group
      return group.type === "part" ? group.ref : undefined
    })
    const message = createMemo(() => {
      const current = ref()
      const message = current ? input.projection.messageByID().get(current.messageID) : undefined
      return message?.type === "assistant" ? message : undefined
    })
    const content = createMemo(() => {
      const current = ref()
      return current ? Timeline.resolveContent(message(), current.partID) : undefined
    })
    const defaultOpen = createMemo(() => {
      const item = content()
      if (!item) return undefined
      return currentContentDefaultOpen(item, input.shellToolDefaultOpen(), input.editToolDefaultOpen())
    })
    return (
      <Show when={message()}>
        {(message) => (
          <Show when={content()}>
            {(content) => (
              <SessionAssistantContent
                message={message()}
                content={content()}
                contentID={ref()!.partID}
                showAssistantCopyPartID={copyContentID(row().userMessageID)}
                turnDurationMs={duration(row().userMessageID)}
                defaultOpen={defaultOpen()}
                toolOpen={input.disclosure.value(row().group.key) ?? defaultOpen()}
                onToolOpenChange={(open) => input.disclosure.set(row().group.key, open)}
                onContentRendered={onSizeChange}
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
        data: message.previous ? `${message.previous} → ${message.agent}` : message.agent,
      }
    if (message.type === "model-switched") return undefined
    if (message.type === "skill") return { label: i18n.t("ui.tool.skill"), data: message.name }
    if (message.type === "system") {
      const prefix = "Instructions updated: "
      if (message.description?.startsWith(prefix)) {
        const keys = message.description
          .slice(prefix.length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        return {
          label: i18n.t("ui.sessionTimeline.notice.instructionsUpdated"),
          items: keys,
        }
      }
      return { label: message.description ?? message.text }
    }
    if (message.type !== "synthetic") return undefined
    if (message.description === "Continuing after restart") return { label: message.description }
    const source = typeof message.metadata?.source === "string" ? message.metadata.source : undefined
    const state = typeof message.metadata?.state === "string" ? message.metadata.state : undefined
    if (source === "subagent" || source === "shell") {
      const agent = typeof message.metadata?.agent === "string" ? message.metadata.agent : undefined
      const actor = source === "shell" ? i18n.t("ui.tool.shell") : (agent ?? i18n.t("ui.tool.agent.default"))
      return {
        label: i18n.t(
          state === "error"
            ? "ui.sessionTimeline.notice.failed"
            : state === "cancelled"
              ? "ui.sessionTimeline.notice.cancelled"
              : "ui.sessionTimeline.notice.finished",
          { actor },
        ),
        data: message.description,
      }
    }
    return { label: message.description ?? message.text }
  }

  const Frame = (props: { row: FramedTimelineRow; children: JSX.Element }) => (
    <div
      id={props.row._tag === "UserMessage" ? input.anchor?.(props.row.userMessageID) : undefined}
      data-message-id={props.row.userMessageID}
      data-timeline-row={props.row._tag}
      data-timeline-spacing={props.row._tag === "AssistantPart" ? props.row.spacing : undefined}
      classList={{
        "min-w-0 w-full max-w-full": true,
        "md:max-w-[1000px] md:mx-auto": input.centered?.(),
        "pt-2": props.row._tag === "AssistantPart" && props.row.spacing === "tool",
        "pt-4": props.row._tag === "AssistantPart" && props.row.spacing === "content",
      }}
    >
      <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
        {props.children}
      </div>
    </div>
  )

  const render = (row: Accessor<TimelineRow.TimelineRow>, onSizeChange?: () => void) => {
    if (row()._tag === "TurnGap") return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
    if (row()._tag === "UserMessage") {
      const current = () => {
        const value = row()
        if (value._tag !== "UserMessage") throw new Error("Expected a user-message timeline row")
        return value
      }
      const message = createMemo(() => {
        const value = input.projection.messageByID().get(current().userMessageID)
        return value?.type === "user" ? value : undefined
      })
      const context = createMemo(() => input.projection.userContextByID().get(current().userMessageID))
      return (
        <Frame row={current()}>
          <Show when={message()}>
            {(message) => {
              const presentation = () => input.presentation(message())
              return (
                <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <SessionUserMessage
                      sessionID={input.sessionID()}
                      message={message()}
                      displayText={presentation()?.displayText}
                      comments={presentation()?.comments}
                      historicalAgent={context()?.agent ?? ""}
                      historicalModel={context()?.model ?? { id: "", providerID: "" }}
                      actions={input.actions}
                    />
                  </div>
                </div>
              )
            }}
          </Show>
        </Frame>
      )
    }
    if (row()._tag === "Shell") {
      const current = () => {
        const value = row()
        if (value._tag !== "Shell") throw new Error("Expected a shell timeline row")
        return value
      }
      const message = createMemo(() => {
        const value = input.projection.messageByID().get(current().messageID)
        return value?.type === "shell" ? value : undefined
      })
      return (
        <Frame row={current()}>
          <Show when={message()}>
            {(message) => (
              <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
                <SessionShellMessage
                  message={message()}
                  defaultOpen={input.shellToolDefaultOpen()}
                  open={input.disclosure.value(message().id)}
                  onOpenChange={(open) => input.disclosure.set(message().id, open)}
                />
              </div>
            )}
          </Show>
        </Frame>
      )
    }
    if (row()._tag === "Notice") {
      const current = () => {
        const value = row()
        if (value._tag !== "Notice") throw new Error("Expected a notice timeline row")
        return value
      }
      const message = createMemo(() => input.projection.messageByID().get(current().messageID))
      const compaction = createMemo(() => {
        const value = message()
        return value?.type === "compaction" ? value : undefined
      })
      const compactionError = createMemo(() => {
        const value = compaction()
        if (value?.status !== "failed") return ""
        return unwrapErrorMessage(value.error.message)
      })
      const moved = createMemo(() => {
        const value = message()
        return value?.type === "location-switched" ? value : undefined
      })
      const model = createMemo(() => {
        const value = message()
        if (value?.type !== "model-switched") return undefined
        const match = data.store.provider?.all?.get(value.model.providerID)
        return {
          providerID: value.model.providerID,
          variant: value.model.variant,
          label: i18n.t("ui.sessionTimeline.notice.modelSwitched", {
            model: match?.models?.[value.model.id]?.name ?? value.model.id,
          }),
        }
      })
      const content = createMemo(() => {
        const value = message()
        return value ? notice(value) : undefined
      })
      return (
        <Frame row={current()}>
          <Show when={compaction()}>
            {(message) => (
              <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
                <div data-slot="session-turn-compaction">
                  <SessionCompactionMessage message={message()} error={compactionError()} />
                </div>
              </div>
            )}
          </Show>
          <Show
            when={moved()}
            fallback={
              <Show
                when={model()}
                fallback={
                  <Show when={content()}>
                    {(content) => (
                      <Show
                        when={content().items?.length}
                        fallback={
                          <div
                            data-slot="session-timeline-notice"
                            class={`w-full pt-3 pb-1 text-13-regular text-text-weak ${padding()}`}
                          >
                            <bdi dir="auto" class="text-13-medium">
                              {content().label}
                            </bdi>
                            <Show when={content().data}>
                              {(data) => (
                                <span>
                                  {" "}
                                  · <bdi dir="auto">{data()}</bdi>
                                </span>
                              )}
                            </Show>
                          </div>
                        }
                      >
                        <div data-slot="session-timeline-notice" class={`w-full py-1 ${padding()}`}>
                          <div class="flex min-h-5 min-w-0 items-center gap-2 overflow-hidden">
                            <bdi
                              dir="auto"
                              class="shrink-0 text-[13px] font-[530] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint"
                            >
                              {content().label}
                            </bdi>
                            <For each={content().items}>
                              {(item) => (
                                <bdi
                                  dir="auto"
                                  class="min-w-0 truncate text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint"
                                >
                                  {item}
                                </bdi>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    )}
                  </Show>
                }
              >
                {(model) => (
                  <div
                    data-slot="session-timeline-notice"
                    data-type="model-switched"
                    class={`w-full py-2 ${padding()}`}
                  >
                    <TimelineSeparator
                      label={model().label}
                      providerID={model().providerID}
                      variant={model().variant}
                    />
                  </div>
                )}
              </Show>
            }
          >
            {(message) => (
              <div
                data-slot="session-timeline-notice"
                data-type="location-switched"
                class={`flex h-7 w-full min-w-0 items-center gap-2 py-1 text-[13px] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint ${padding()}`}
              >
                <Tooltip
                  appearance="compact"
                  placement="top"
                  value={i18n.t("ui.sessionTimeline.notice.movedTooltip")}
                  class="shrink-0"
                  triggerTabIndex={0}
                >
                  <bdi data-slot="session-timeline-notice-label" dir="auto" class="font-[530]">
                    {i18n.t("ui.sessionTimeline.notice.movedTo")}
                  </bdi>
                </Tooltip>{" "}
                <bdi data-slot="session-timeline-notice-value" dir="ltr" class="min-w-0 truncate font-[440]">
                  {message().location.directory}
                </bdi>
              </div>
            )}
          </Show>
        </Frame>
      )
    }
    if (row()._tag === "TurnDivider") {
      const current = () => {
        const value = row()
        if (value._tag !== "TurnDivider") throw new Error("Expected a turn-divider timeline row")
        return value
      }
      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-compaction">
              <div class="py-2">
                <TimelineSeparator label={i18n.t("ui.message.interrupted")} />
              </div>
            </div>
          </div>
        </Frame>
      )
    }
    if (row()._tag === "AssistantPart") {
      const current = () => {
        const value = row()
        if (value._tag !== "AssistantPart") throw new Error("Expected an assistant-part timeline row")
        return value
      }
      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-assistant-content" aria-hidden={workingTurn(current().userMessageID)}>
              {renderAssistant(current, onSizeChange)}
            </div>
          </div>
        </Frame>
      )
    }
    if (row()._tag === "Thinking") {
      const current = () => {
        const value = row()
        if (value._tag !== "Thinking") throw new Error("Expected a thinking timeline row")
        return value
      }
      const animateHeading = createMemo<boolean>((previous) => previous ?? !current().reasoningHeading)
      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <div data-slot="session-turn-thinking-row">
              <BasicTool
                icon="mcp"
                status="running"
                compact
                locked
                hideDetails
                trigger={
                  <div data-slot="session-turn-thinking">
                    <div data-slot="basic-tool-tool-info-structured">
                      <div data-slot="basic-tool-tool-info-main">
                        <span data-slot="basic-tool-tool-title">
                          <TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} />
                        </span>
                        <Show when={!input.showReasoningSummaries()}>
                          <span data-slot="basic-tool-tool-subtitle">
                            <TextReveal
                              text={current().reasoningHeading}
                              class="session-turn-thinking-heading"
                              travel={animateHeading() ? 25 : 0}
                              duration={animateHeading() ? 700 : 0}
                            />
                          </span>
                        </Show>
                      </div>
                    </div>
                  </div>
                }
              />
            </div>
          </div>
        </Frame>
      )
    }
    if (row()._tag === "Retry") {
      const current = () => {
        const value = row()
        if (value._tag !== "Retry") throw new Error("Expected a retry timeline row")
        return value
      }
      const status = createMemo(() => {
        const retry = (
          input.projection.assistantMessagesByParent().get(current().userMessageID) ?? emptyAssistantMessages
        ).at(-1)?.retry
        if (!retry) return input.status()
        return { type: "retry" as const, attempt: retry.attempt, message: retry.error.message, next: retry.at }
      })
      return (
        <Frame row={current()}>
          <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
            <SessionRetry status={status()} show={input.projection.activeMessageID() === current().userMessageID} />
          </div>
        </Frame>
      )
    }
    const current = () => {
      const value = row()
      if (value._tag !== "Error") throw new Error("Expected an error timeline row")
      return value
    }
    return (
      <Frame row={current()}>
        <div data-slot="session-turn-message-container" class={`w-full ${padding()}`}>
          <Card variant="error" class="error-card">
            {current().text}
          </Card>
        </div>
      </Frame>
    )
  }

  function Row(props: { row: Accessor<TimelineRow.TimelineRow>; onSizeChange?: () => void }) {
    return (
      <Show when={TimelineRow.key(props.row())} keyed>
        {(_key) => render(props.row, props.onSizeChange)}
      </Show>
    )
  }

  return { Row }
}
