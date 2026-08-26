import type { SessionMessageAssistant } from "@opencode-ai/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
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

function HiddenReasoningLifecycleStory() {
  const [state, setState] = createStore({ phase: "thinking" })
  const document = createMemo(() => {
    const finished = state.phase === "idle"
    const running = state.phase === "running"
    return {
      sessionID: CURRENT_SESSION_ID,
      messages: [
        ...thinkingDocument.messages,
        {
          id: "msg_hidden_reasoning_lifecycle",
          type: "assistant",
          agent: "build",
          model: STORY_MODEL,
          content: [
            {
              type: "reasoning",
              text: "## Inspecting stability",
              time: { created: STORY_TIME + 100 },
            },
            ...(running || finished
              ? [
                  {
                    type: "tool" as const,
                    id: "tool_hidden_reasoning_shell",
                    name: "shell",
                    state: finished
                      ? {
                          status: "completed" as const,
                          input: { command: "printf done" },
                          content: [{ type: "text" as const, text: "done" }],
                          metadata: {},
                        }
                      : { status: "running" as const, input: { command: "printf done" }, metadata: {} },
                    time: {
                      created: STORY_TIME + 200,
                      ran: STORY_TIME + 250,
                      ...(finished ? { completed: STORY_TIME + 300 } : {}),
                    },
                  },
                ]
              : []),
          ],
          time: { created: STORY_TIME, ...(finished ? { completed: STORY_TIME + 400 } : {}) },
        },
      ],
      status: { type: finished ? "idle" : "busy" },
      diffs: [],
    } satisfies SessionDocument
  })
  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={() => setState("phase", "running")}>
          Start shell
        </button>
        <button type="button" onClick={() => setState("phase", "idle")}>
          Finish session
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} showReasoningSummaries={false} />
      </CurrentSessionProviders>
    </section>
  )
}

function RetryRecoveryLifecycleStory() {
  const [state, setState] = createStore({ phase: "thinking" })
  const document = createMemo(() => {
    const retry = state.phase === "retry"
    const finished = state.phase === "idle"
    return {
      sessionID: CURRENT_SESSION_ID,
      messages: [
        ...thinkingDocument.messages,
        {
          id: "msg_retry_recovery_lifecycle",
          type: "assistant",
          agent: "build",
          model: STORY_MODEL,
          content: finished ? [{ type: "text" as const, text: "Recovered response" }] : [],
          ...(retry
            ? {
                retry: {
                  attempt: 2,
                  at: 1_900_000_000_000,
                  error: { type: "ProviderRateLimitError", message: "Rate limit reached. Retrying with backoff." },
                },
              }
            : {}),
          time: { created: STORY_TIME, ...(finished ? { completed: STORY_TIME + 300 } : {}) },
        },
      ],
      status: { type: finished ? "idle" : "busy" },
      diffs: [],
    } satisfies SessionDocument
  })
  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={() => setState("phase", "retry")}>
          Retry request
        </button>
        <button type="button" onClick={() => setState("phase", "thinking")}>
          Recover request
        </button>
        <button type="button" onClick={() => setState("phase", "idle")}>
          Finish response
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const HiddenReasoningLifecycle = { render: () => <HiddenReasoningLifecycleStory /> }
export const RetryRecoveryLifecycle = { render: () => <RetryRecoveryLifecycleStory /> }
