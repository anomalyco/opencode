import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import { Show, createMemo } from "solid-js"
import type { SessionUserActions, SessionUserComment } from "../actions"
import { ContextToolGroup, Message, Part, type UserActions } from "../components/legacy-message-part"
import { partDefaultOpen } from "../components/part-default-open"
import type { FilePart, ToolPart } from "../presentation"
import {
  toLegacyAssistantContent,
  toLegacyAssistantMessage,
  toLegacyUserMessage,
  toLegacyUserParts,
} from "./legacy-message-values"

export type { SessionUserActions, SessionUserComment } from "../actions"
export { MessageDivider, SessionShellMessage } from "../components/legacy-message-part"

export function SessionUserMessage(props: {
  sessionID: string
  message: SessionMessageUser
  displayText?: string
  comments?: SessionUserComment[]
  historicalAgent: string
  historicalModel: SessionMessageAssistant["model"]
  actions?: SessionUserActions
  useV2Actions?: boolean
}) {
  const message = createMemo(() =>
    toLegacyUserMessage(props.sessionID, props.message, props.historicalAgent, props.historicalModel),
  )
  const parts = createMemo(() => toLegacyUserParts(props.sessionID, props.message, props.displayText, props.comments))
  const actions = createMemo(() => {
    if (!props.actions) return
    return {
      revert: props.actions.revert,
      openAttachment: props.actions.openAttachment
        ? (file: FilePart) => {
            const attachment = (props.message.files ?? []).find(
              (_, index) => file.id === `${props.message.id}:file:${index}`,
            )
            if (attachment) props.actions?.openAttachment?.(attachment)
          }
        : undefined,
    } satisfies UserActions
  })
  return (
    <Message
      message={message()}
      parts={parts()}
      comments={props.comments}
      actions={actions()}
      useV2Actions={props.useV2Actions}
    />
  )
}

export function SessionAssistantContent(props: {
  sessionID: string
  parentID: string
  message: SessionMessageAssistant
  content: SessionMessageAssistant["content"][number]
  contentID: string
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  useV2Actions?: boolean
  defaultOpen?: boolean
  toolOpen?: boolean
  onToolOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  const message = createMemo(() => toLegacyAssistantMessage(props.sessionID, props.parentID, props.message))
  const part = createMemo(() =>
    toLegacyAssistantContent(props.sessionID, props.message, props.contentID, props.content),
  )
  return (
    <Show when={part()}>
      {(part) => (
        <Part
          part={part()}
          message={message()}
          showAssistantCopyPartID={props.showAssistantCopyPartID}
          turnDurationMs={props.turnDurationMs}
          useV2Actions={props.useV2Actions}
          defaultOpen={props.defaultOpen}
          toolOpen={props.toolOpen}
          onToolOpenChange={props.onToolOpenChange}
          deferToolContent
          virtualizeDiff={false}
          onContentRendered={props.onContentRendered}
        />
      )}
    </Show>
  )
}

export function SessionContextToolGroup(props: {
  sessionID: string
  tools: { message: SessionMessageAssistant; content: SessionMessageAssistantTool; contentID: string }[]
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
}) {
  const parts = createMemo(() =>
    props.tools.flatMap((item): ToolPart[] => {
      const part = toLegacyAssistantContent(props.sessionID, item.message, item.contentID, item.content)
      return part.type === "tool" ? [part] : []
    }),
  )
  return (
    <ContextToolGroup
      parts={parts()}
      open={props.open}
      busy={props.busy}
      onOpenChange={props.onOpenChange}
      onSizeChange={props.onSizeChange}
    />
  )
}

export function currentContentDefaultOpen(
  sessionID: string,
  message: SessionMessageAssistant,
  content: SessionMessageAssistant["content"][number],
  contentID: string,
  shellExpanded: boolean,
  editExpanded: boolean,
) {
  return partDefaultOpen(toLegacyAssistantContent(sessionID, message, contentID, content), shellExpanded, editExpanded)
}
