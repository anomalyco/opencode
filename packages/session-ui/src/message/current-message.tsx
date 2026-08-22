import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import { Match, Switch } from "solid-js"
import type { SessionUserActions, SessionUserComment } from "../actions"
import { AssistantReasoningContent, AssistantTextContent, CurrentUserMessageDisplay } from "./message-content"
import { CurrentContextToolGroup, CurrentFileToolGroup, ToolDisplay } from "../tools/tool-renderer"
import { currentToolError, currentToolInput, currentToolMetadata, currentToolOutput } from "./current-tool-state"

export type { SessionUserActions, SessionUserComment } from "../actions"
export { MessageDivider } from "./message-content"
export { SessionShellMessage } from "../tools/tool-renderer"
export { currentContentDefaultOpen } from "./current-tool-state"

export function SessionUserMessage(props: {
  sessionID: string
  message: SessionMessageUser
  displayText?: string
  comments?: SessionUserComment[]
  historicalAgent: string
  historicalModel: SessionMessageAssistant["model"]
  actions?: SessionUserActions
}) {
  return (
    <CurrentUserMessageDisplay
      sessionID={props.sessionID}
      message={props.message}
      text={props.displayText ?? props.message.text}
      comments={props.comments}
      agent={props.historicalAgent}
      model={props.historicalModel}
      actions={props.actions}
    />
  )
}

export function SessionAssistantContent(props: {
  message: SessionMessageAssistant
  content: SessionMessageAssistant["content"][number]
  contentID: string
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  defaultOpen?: boolean
  toolOpen?: boolean
  onToolOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  return (
    <Switch>
      <Match when={props.content.type === "text" ? props.content : undefined}>
        {(content) => (
          <AssistantTextContent
            id={props.contentID}
            text={content().text}
            message={props.message}
            showCopy={props.showAssistantCopyPartID === props.contentID}
            turnDurationMs={props.turnDurationMs}
          />
        )}
      </Match>
      <Match when={props.content.type === "reasoning" ? props.content : undefined}>
        {(content) => (
          <AssistantReasoningContent
            id={props.contentID}
            text={content().text}
            streaming={typeof props.message.time.completed !== "number"}
          />
        )}
      </Match>
      <Match when={props.content.type === "tool" ? props.content : undefined}>
        {(tool) => (
          <ToolDisplay
            id={props.contentID}
            tool={tool().name}
            input={currentToolInput(tool())}
            metadata={currentToolMetadata(tool())}
            output={currentToolOutput(tool())}
            status={tool().state.status}
            error={currentToolError(tool())}
            defaultOpen={props.defaultOpen}
            open={props.toolOpen}
            onOpenChange={props.onToolOpenChange}
            deferContent
            virtualizeDiff={false}
            onContentRendered={props.onContentRendered}
          />
        )}
      </Match>
    </Switch>
  )
}

export function SessionContextToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
}) {
  return (
    <CurrentContextToolGroup
      tools={props.tools}
      open={props.open}
      busy={props.busy}
      onOpenChange={props.onOpenChange}
      onSizeChange={props.onSizeChange}
    />
  )
}

export function SessionFileToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  fileOpen: (path: string) => boolean | undefined
  onFileOpenChange: (path: string, open: boolean) => void
  onSizeChange?: () => void
}) {
  return (
    <CurrentFileToolGroup
      tools={props.tools}
      fileOpen={props.fileOpen}
      onFileOpenChange={props.onFileOpenChange}
      onSizeChange={props.onSizeChange}
    />
  )
}
