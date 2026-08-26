import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { SessionTimeline } from "./session-timeline"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import {
  CURRENT_SESSION_ID,
  STORY_MODEL,
  STORY_TIME,
  attachmentsAndCommentsDocument,
  attachmentsAndCommentsPresentation,
  compactionCancelledDocument,
  compactionDocument,
  compactionFailedDocument,
  compactionRunningDocument,
  instructionsUpdatedMultipleDocument,
  instructionsUpdatedSingleDocument,
  requestHistoryDocument,
  retryDocument,
  revertDocument,
  streamingDocument,
  thinkingDocument,
} from "../storybook/current-session-fixtures"

export default {
  title: "OpenCode/Conversation/Message states",
  id: "current-session-timeline-rows",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Focused current-message states rendered through the production timeline projection and message components.",
      },
    },
  },
}

export const AgentThinking = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Agent thinking"
      description="The prompt is admitted and the active turn is waiting for its first visible content."
      document={thinkingDocument}
      width="560px"
    />
  ),
}

export const StreamingReasoningAndText = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Streaming reasoning and text"
      description="The active turn contains a reasoning summary and a partial response."
      document={streamingDocument}
      width="560px"
    />
  ),
}

function AgentReasoningStory(props: { summaries: boolean; reasoning: string; tool: boolean; text: string }) {
  const content = [
    ...(props.reasoning === "none"
      ? []
      : [
          {
            type: "reasoning" as const,
            text: props.reasoning === "blank" ? "   " : "## Inspecting stability",
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
    ...(props.text ? [{ type: "text" as const, text: props.text }] : []),
  ] satisfies SessionMessageAssistant["content"]
  const document = {
    sessionID: CURRENT_SESSION_ID,
    messages: [
      ...thinkingDocument.messages,
      {
        id: "msg_projection_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        content,
        time: { created: STORY_TIME },
      },
    ],
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

const AgentReasoning = {
  args: { summaries: true, reasoning: "heading", tool: false, text: "" },
  argTypes: { reasoning: { control: "select", options: ["none", "blank", "heading"] } },
  render: (args: { summaries: boolean; reasoning: string; tool: boolean; text: string }) => (
    <AgentReasoningStory {...args} />
  ),
}

function HiddenReasoningStory() {
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
            { type: "reasoning", text: "## Inspecting stability", time: { created: STORY_TIME + 100 } },
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

const WorkingWithoutReasoningDetails = { render: () => <HiddenReasoningStory /> }

function RetryAndRecoverStory() {
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

const RetryAndRecover = { render: () => <RetryAndRecoverStory /> }

export const ProviderRetry = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Provider retry"
      description="A temporary provider limit keeps the turn active and explains the scheduled retry."
      document={retryDocument}
      width="520px"
    />
  ),
}

const noticeUser = { id: "msg_notice_user", type: "user", text: "Run it", time: { created: STORY_TIME } } as const
const noticeAssistant = {
  id: "msg_notice_assistant",
  type: "assistant",
  agent: "build",
  model: STORY_MODEL,
  content: [{ type: "text", text: "Working" }],
  time: { created: STORY_TIME + 1, completed: STORY_TIME + 2 },
} satisfies SessionMessageInfo

const AgentActivityNotices = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Agent activity and Session notices"
      description="Agent changes, delegated work, restarted Sessions, and loaded skills appear in their original order."
      document={{
        sessionID: CURRENT_SESSION_ID,
        status: { type: "idle" },
        diffs: [],
        messages: [
          noticeUser,
          { id: "msg_notice_agent", type: "agent-switched", agent: "explore", time: { created: STORY_TIME + 1 } },
          noticeAssistant,
          {
            id: "msg_notice_subagent",
            type: "synthetic",
            text: "done",
            description: "Search code",
            metadata: { source: "subagent", agent: "explore", state: "completed" },
            time: { created: STORY_TIME + 3 },
          },
          {
            id: "msg_notice_restart",
            type: "synthetic",
            text: "continue",
            description: "Continuing after restart",
            time: { created: STORY_TIME + 4 },
          },
          {
            id: "msg_notice_skill",
            type: "skill",
            skill: "review",
            name: "Review",
            text: "instructions",
            time: { created: STORY_TIME + 5 },
          },
        ],
      }}
      width="720px"
    />
  ),
}

function CompactSessionStory() {
  const [state, setState] = createStore({ phase: "running", summary: "", second: false })
  const document = createMemo(() => {
    const failed = state.phase === "failed"
    const completed = state.phase === "completed"
    const message = {
      id: "msg_notice_compaction",
      type: "compaction" as const,
      status: failed ? ("failed" as const) : completed ? ("completed" as const) : ("running" as const),
      reason: "auto" as const,
      ...(failed
        ? {
            error: {
              type: "compaction.failed",
              message: 'Error: {"error":{"type":"ProviderError","message":"The provider rejected the summary."}}',
            },
          }
        : { summary: state.summary, recent: "" }),
      time: { created: STORY_TIME + 10 },
    }
    const cancelled = {
      id: "msg_notice_compaction_cancelled",
      type: "compaction" as const,
      status: "failed" as const,
      reason: "manual" as const,
      error: { type: "aborted", message: "Cancellation detail should stay hidden." },
      time: { created: STORY_TIME + 20 },
    }
    return {
      sessionID: CURRENT_SESSION_ID,
      messages: [noticeUser, noticeAssistant, message, ...(state.second ? [cancelled] : [])],
      status: { type: completed || failed ? "idle" : "busy" },
      diffs: [],
    } satisfies SessionDocument
  })
  return (
    <section class="mx-auto flex w-full max-w-[760px] flex-col gap-4 p-6">
      <div class="flex flex-wrap gap-3">
        <button type="button" onClick={() => setState("summary", "## Checkpoint\n\nStreamed implementation details.")}>
          Stream summary
        </button>
        <button
          type="button"
          onClick={() => setState({ phase: "completed", summary: "## Checkpoint\n\nFinal implementation details." })}
        >
          Complete summary
        </button>
        <button type="button" onClick={() => setState("phase", "failed")}>
          Fail compaction
        </button>
        <button type="button" onClick={() => setState("second", true)}>
          Cancel next compaction
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

const CompactSession = { render: () => <CompactSessionStory /> }

export const CompactionInProgress = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction in progress"
      description="The production divider remains stable while the context summary streams below it."
      document={compactionRunningDocument}
      width="600px"
    />
  ),
}

export const CompactionAndContinuation = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction and continuation"
      description="The context summary separates earlier output from the continued response."
      document={compactionDocument}
      width="600px"
    />
  ),
}

export const CompactionFailed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction failed"
      description="A failed compaction keeps the production divider and shows the provider error."
      document={compactionFailedDocument}
      width="600px"
    />
  ),
}

export const CompactionCancelled = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction cancelled"
      description="An interrupted compaction keeps the production divider without an empty error block."
      document={compactionCancelledDocument}
      width="600px"
    />
  ),
}

export const AnsweredQuestionAndDeclinedCommand = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Answered question and declined command"
      description="The chosen answer remains in history, and the declined command keeps its user-visible result."
      document={requestHistoryDocument}
      width="620px"
      shellToolDefaultOpen
    />
  ),
}

export const RevertBoundary = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Revert boundary"
      description="The latest user message exposes the production revert action for choosing a rollback point."
      document={revertDocument}
      width="620px"
    />
  ),
}

export const PromptWithAttachments = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Prompt with attachments"
      description="A user message combines text, two files, an agent mention, and a selected-line comment."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

export const MixedDirectionRtl = {
  globals: { direction: "rtl" },
  render: () => (
    <CurrentSessionTimelineStory
      title="Mixed-direction prompt in RTL"
      description="Forced RTL keeps file paths and code readable without changing the message order."
      document={attachmentsAndCommentsDocument}
      presentation={attachmentsAndCommentsPresentation}
      width="480px"
    />
  ),
}

const MovedLocation = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Moved Session location"
      description="A changed working directory stays compact, truncates, and exposes its tooltip."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          ...thinkingDocument.messages,
          {
            id: "msg_story_location",
            type: "location-switched",
            location: { directory: `/Users/usrnk1/Developer/opencode/${"nested-directory/".repeat(24)}session` },
            time: { created: 1_735_689_633_000 },
          },
        ],
      }}
      width="480px"
    />
  ),
}

const InterruptedTurn = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Interrupted assistant turn"
      description="The interruption divider stays between the original response and its continuation."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          ...thinkingDocument.messages,
          {
            id: "msg_story_interrupted_before",
            type: "assistant",
            agent: "build",
            model: { id: "claude-sonnet-4", providerID: "anthropic" },
            content: [{ type: "text", text: "Before" }],
            error: { type: "MessageAbortedError", message: "Stopped" },
            time: { created: 1_735_689_633_000, completed: 1_735_689_634_000 },
          },
          {
            id: "msg_story_interrupted_after",
            type: "assistant",
            agent: "build",
            model: { id: "claude-sonnet-4", providerID: "anthropic" },
            content: [{ type: "text", text: "After" }],
            time: { created: 1_735_689_635_000, completed: 1_735_689_636_000 },
          },
        ],
      }}
      width="560px"
    />
  ),
}

const AliasedModelNotices = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Aliased model notices"
      description="Provider display names, model variants, and long-name truncation use the production notice component."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          {
            id: "msg_story_fast_nano",
            type: "model-switched",
            model: { providerID: "company-gateway", id: "fast-nano", variant: "xhigh" },
            time: { created: 1_735_689_590_000 },
          },
          {
            id: "msg_story_long_context",
            type: "model-switched",
            model: { providerID: "company-gateway", id: "long-context" },
            time: { created: 1_735_689_591_000 },
          },
          ...thinkingDocument.messages,
        ],
      }}
      width="420px"
    />
  ),
}

const RichUserAttachments = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Prompt with rich attachments"
      description="An image, JSON attachment, source-file reference, and agent mention remain individually visible."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          {
            id: "msg_story_rich_user",
            type: "user",
            text: "Use @explore with @src/a.ts and inspect the attachments",
            agents: [{ name: "explore", mention: { text: "@explore", start: 4, end: 12 } }],
            files: [
              {
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                mime: "image/png",
                name: "pixel.png",
                source: { type: "inline" },
              },
              { data: "e30=", mime: "application/json", name: "tsconfig.json", source: { type: "inline" } },
              {
                data: "",
                mime: "text/plain",
                name: "a.ts",
                source: { type: "path", path: "src/a.ts" },
                mention: { text: "@src/a.ts", start: 18, end: 27 },
              },
            ],
            time: { created: 1_735_689_633_000 },
          },
        ],
      }}
      width="620px"
    />
  ),
}

const conversationScenarios = {
  reasoning: AgentReasoning,
  hidden: WorkingWithoutReasoningDetails,
  retry: RetryAndRecover,
  notices: AgentActivityNotices,
  compaction: CompactSession,
  location: MovedLocation,
  interruption: InterruptedTurn,
  models: AliasedModelNotices,
  attachments: RichUserAttachments,
}

export const Conversation = {
  args: { scenario: "notices", summaries: true, reasoning: "heading", tool: false, text: "" },
  argTypes: {
    scenario: { control: "select", options: Object.keys(conversationScenarios) },
    reasoning: { control: "select", options: ["none", "blank", "heading"] },
  },
  render: (args: { scenario: string; summaries: boolean; reasoning: string; tool: boolean; text: string }) => {
    if (args.scenario === "reasoning") return <AgentReasoningStory {...args} />
    return conversationScenarios[args.scenario as Exclude<keyof typeof conversationScenarios, "reasoning">].render()
  },
}

export const InstructionsUpdatedSingle = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Instructions updated (single)"
      description="A system notice in the timeline showing a single updated instruction source."
      document={instructionsUpdatedSingleDocument}
      width="600px"
    />
  ),
}

export const InstructionsUpdatedMultiple = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Instructions updated (multiple)"
      description="A system notice in the timeline showing multiple updated instruction sources."
      document={instructionsUpdatedMultipleDocument}
      width="600px"
    />
  ),
}
