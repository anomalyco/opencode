import type { SessionMessageAssistant } from "@opencode/client/promise"
import { Match, Switch } from "solid-js"
import { AssistantTextContent } from "../../message/message-content"
import {
  currentToolError,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from "../../message/current-tool-state"
import type { TurnSources } from "../../sources/sources"
import { toolRule, toolStopped } from "../rules"
import { ThoughtRow } from "./thought"
import { ToolDisplay } from "./tool-display"

/** One part of an assistant message on its own row: the agent's words, a thought, or a call. */
export function AssistantContent(props: {
  message: SessionMessageAssistant
  content: SessionMessageAssistant["content"][number]
  contentID: string
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number | null
  turnTokensPerSecond?: number
  sources?: TurnSources
  onOpenSources?: () => void
  defaultOpen?: boolean
  reasoningDefaultOpen?: boolean
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
            turnTokensPerSecond={props.turnTokensPerSecond}
            sources={props.sources}
            onOpenSources={props.onOpenSources}
          />
        )}
      </Match>
      <Match when={props.content.type === "reasoning" ? props.content : undefined}>
        {(content) => (
          <ThoughtRow
            id={props.contentID}
            content={content()}
            streaming={false}
            defaultOpen={props.reasoningDefaultOpen}
            open={props.toolOpen}
            onOpenChange={props.onToolOpenChange}
            onContentRendered={props.onContentRendered}
          />
        )}
      </Match>
      <Match when={props.content.type === "tool" ? props.content : undefined}>
        {(tool) => (
          <ToolDisplay
            id={props.contentID}
            tool={toolRule(tool()).name}
            input={currentToolInput(tool())}
            metadata={currentToolMetadata(tool())}
            output={currentToolOutput(tool())}
            status={tool().state.status}
            error={currentToolError(tool())}
            stopped={toolStopped(tool())}
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
