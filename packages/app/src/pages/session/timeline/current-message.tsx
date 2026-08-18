import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import {
  ContextToolGroup,
  Message,
  Part as MessagePart,
  partDefaultOpen,
  type UserActions,
} from "@opencode-ai/session-ui/message-part"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import {
  presentAssistantMessage,
  presentAssistantContent,
  presentUserMessage,
  presentUserParts,
} from "@/utils/session-message"
import { createMemo, Show } from "solid-js"

export function CurrentUserMessage(props: {
  sessionID: string
  message: SessionMessageUser
  agent: string
  model: { id: string; providerID: string; variant?: string }
  actions?: UserActions
  useV2Actions?: boolean
  comments?: { path: string; comment: string; selection?: { startLine: number; endLine: number } }[]
}) {
  const message = createMemo(() => presentUserMessage(props.sessionID, props.message, props.agent, props.model))
  const parts = createMemo(() => presentUserParts(props.sessionID, props.message))
  return (
    <Message
      message={message()}
      parts={parts()}
      actions={props.actions}
      useV2Actions={props.useV2Actions}
      comments={props.comments}
    />
  )
}

export function CurrentAssistantContent(props: {
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
  const message = createMemo(() => presentAssistantMessage(props.sessionID, props.parentID, props.message))
  const part = createMemo(() =>
    presentAssistantContent(props.sessionID, props.message, props.contentID, props.content),
  )
  return (
    <Show when={part()}>
      {(part) => (
        <MessagePart
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

export function CurrentContextToolGroup(props: {
  sessionID: string
  tools: { message: SessionMessageAssistant; content: SessionMessageAssistantTool; contentID: string }[]
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
}) {
  const parts = createMemo(() =>
    props.tools.flatMap(({ message, content, contentID }): ToolPart[] => {
      const part = presentAssistantContent(props.sessionID, message, contentID, content)
      return part?.type === "tool" ? [part] : []
    }),
  )
  return (
    <ContextToolGroup
      parts={parts()}
      open={props.open}
      onOpenChange={props.onOpenChange}
      busy={props.busy}
      onSizeChange={props.onSizeChange}
    />
  )
}

export function currentPartDefaultOpen(
  sessionID: string,
  message: SessionMessageAssistant,
  content: SessionMessageAssistant["content"][number],
  contentID: string,
  shellExpanded: boolean,
  editExpanded: boolean,
) {
  return partDefaultOpen(
    presentAssistantContent(sessionID, message, contentID, content),
    shellExpanded,
    editExpanded,
  )
}
