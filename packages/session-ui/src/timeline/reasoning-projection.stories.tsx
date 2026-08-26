import type { SessionMessageAssistant } from "@opencode-ai/client/promise"
import type { SessionDocument } from "../document"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME, thinkingDocument } from "../storybook/current-session-fixtures"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Reasoning projection",
  id: "current-session-reasoning-projection",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Busy reasoning, thinking, and tool visibility rendered directly by the production timeline.",
      },
    },
  },
}

function ReasoningProjection(props: { summaries: boolean; reasoning?: string; tool?: boolean; text?: string }) {
  const content = [
    ...(props.reasoning === undefined
      ? []
      : [
          {
            type: "reasoning" as const,
            text: props.reasoning,
            time: { created: STORY_TIME + 100 },
          },
        ]),
    ...(props.tool
      ? [
          {
            type: "tool" as const,
            id: "tool_reasoning_projection_skill",
            name: "skill",
            state: { status: "running" as const, input: { name: "inspect" }, metadata: {} },
            time: { created: STORY_TIME + 200, ran: STORY_TIME + 250 },
          },
        ]
      : []),
    ...(props.text === undefined ? [] : [{ type: "text" as const, text: props.text }]),
  ] satisfies SessionMessageAssistant["content"]
  const assistant = {
    id: "msg_projection_assistant",
    type: "assistant",
    agent: "build",
    model: STORY_MODEL,
    content,
    time: { created: STORY_TIME },
  } satisfies SessionMessageAssistant
  const document = {
    sessionID: CURRENT_SESSION_ID,
    messages: [...thinkingDocument.messages, assistant],
    status: { type: "busy" },
    diffs: [],
  } satisfies SessionDocument

  return (
    <section class="mx-auto w-full max-w-[720px] p-6">
      <CurrentSessionProviders document={document}>
        <SessionTimeline document={document} showReasoningSummaries={props.summaries} />
      </CurrentSessionProviders>
    </section>
  )
}

export const SummariesOffNoReasoning = { render: () => <ReasoningProjection summaries={false} /> }
export const SummariesOffReasoningHeading = {
  render: () => <ReasoningProjection summaries={false} reasoning="## Inspecting stability" />,
}
export const SummariesOffWithVisibleTool = {
  render: () => <ReasoningProjection summaries={false} reasoning="## Inspecting stability" tool />,
}
export const SummariesOnNoContent = { render: () => <ReasoningProjection summaries /> }
export const SummariesOnBlankReasoning = { render: () => <ReasoningProjection summaries reasoning="   " /> }
export const SummariesOnVisibleReasoning = {
  render: () => <ReasoningProjection summaries reasoning="## Inspecting stability" />,
}
export const SummariesOnVisibleToolNoReasoning = { render: () => <ReasoningProjection summaries tool /> }
export const ProviderWithoutReasoning = { render: () => <ReasoningProjection summaries text="No reasoning payload" /> }
