import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { createMemo, For, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { SessionTimeline } from "./session-timeline"
import { CommentCard, commentCardTarget } from "../message/comment-card"
import type { ReasoningMode } from "./projection"
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
  compactionManualDocument,
  compactionRunningDocument,
  instructionsUpdatedMultipleDocument,
  instructionsUpdatedSingleDocument,
  requestHistoryDocument,
  retryDocument,
  revertDocument,
  streamingDocument,
  thinkingDocument,
  voiceDocument,
  voicePresentation,
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
  render: () => <AgentReasoningStory mode="compact" reasoning="heading" tool={false} text="" />,
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

function AgentReasoningStory(props: { mode: ReasoningMode; reasoning: string; tool: boolean; text: string }) {
  const content = [
    ...(props.reasoning === "none"
      ? []
      : [
          {
            type: "reasoning" as const,
            text:
              props.reasoning === "blank"
                ? "   "
                : "## Inspecting stability\n\nI will inspect the timeline before changing its state.",
            time: { created: STORY_TIME + 100, completed: props.tool || props.text ? STORY_TIME + 7100 : undefined },
          },
        ]),
    ...(props.tool
      ? [
          {
            type: "tool" as const,
            id: "tool_reasoning_projection_skill",
            name: "skill",
            state: { status: "running" as const, input: { name: "inspect" }, metadata: {} },
            time: { created: STORY_TIME + 7200, ran: STORY_TIME + 7250 },
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
        <SessionTimeline document={document} reasoningMode={props.mode} />
      </CurrentSessionProviders>
    </section>
  )
}

const AgentReasoning = {
  args: { mode: "compact", reasoning: "heading", tool: false, text: "" },
  argTypes: { reasoning: { control: "select", options: ["none", "blank", "heading"] } },
  render: (args: { mode: ReasoningMode; reasoning: string; tool: boolean; text: string }) => (
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
                      completed: finished ? STORY_TIME + 300 : undefined,
                    },
                  },
                ]
              : []),
          ],
          time: { created: STORY_TIME, completed: finished ? STORY_TIME + 400 : undefined },
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
        <SessionTimeline document={document()} reasoningMode="compact" />
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
          retry: retry
            ? {
                attempt: 2,
                at: 1_900_000_000_000,
                error: {
                  type: "ProviderRateLimitError" as const,
                  message: "Rate limit reached. Retrying with backoff.",
                },
              }
            : undefined,
          time: { created: STORY_TIME, completed: finished ? STORY_TIME + 300 : undefined },
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
      <CurrentSessionProviders document={document()} backgroundCompaction>
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
        : { summary: state.summary }),
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
      <CurrentSessionProviders document={document()} backgroundCompaction>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

const CompactSession = { render: () => <CompactSessionStory /> }

// Automatic compactions only show quietly with experimental.background_compaction on; turn it off to see today's record.
const backgroundCompaction = {
  args: { backgroundCompaction: true },
  argTypes: { backgroundCompaction: { control: "boolean" } },
}

export const CompactionInProgress = {
  ...backgroundCompaction,
  render: (args: { backgroundCompaction: boolean }) => (
    <CurrentSessionTimelineStory
      title="Compaction in progress"
      description="With background compaction on, an automatic compaction is one quiet divider whose lines carry light toward Compacting."
      document={compactionRunningDocument}
      width="600px"
      backgroundCompaction={args.backgroundCompaction}
    />
  ),
}

export const CompactionAndContinuation = {
  ...backgroundCompaction,
  render: (args: { backgroundCompaction: boolean }) => (
    <CurrentSessionTimelineStory
      title="Compaction and continuation"
      description="With background compaction on, a finished automatic compaction reads Compacted; clicking it opens the summary."
      document={compactionDocument}
      width="600px"
      backgroundCompaction={args.backgroundCompaction}
    />
  ),
}

export const CompactionManual = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Manual compaction"
      description="A /compact keeps the full record: started divider, summary and usage."
      document={compactionManualDocument}
      width="600px"
      backgroundCompaction
    />
  ),
}

/** Replays an automatic compaction live: Working, then the divider for `duration` ms, then the continued reply. */
function CompactionReplayStory(props: { duration: number }) {
  // The fixture's earlier reply was cut off for the compaction; here it finished, so no Interrupted divider shows first.
  const prelude = compactionDocument.messages
    .slice(0, 2)
    .map((message) => (message.type === "assistant" ? { ...message, error: undefined } : message))

  const [compaction, continuation] = [compactionDocument.messages[2], compactionDocument.messages[3]]
  const [state, setState] = createStore({ phase: "working", created: 0, run: 0 })

  const start = () => {
    const run = state.run + 1
    setState({ phase: "working", created: 0, run })
    const at = (ms: number, apply: () => void) => setTimeout(() => state.run === run && apply(), ms)
    at(1_500, () => setState({ phase: props.duration > 0 ? "running" : "completed", created: Date.now() }))
    at(1_500 + props.duration, () => setState("phase", "completed"))
    at(2_900 + props.duration, () => setState("phase", "continued"))
  }

  onMount(start)
  onCleanup(() => setState("run", -1))

  const document = createMemo(() => {
    if (state.phase === "working" || compaction?.type !== "compaction" || compaction.status !== "completed")
      return { ...compactionDocument, messages: prelude, status: { type: "busy" } } satisfies SessionDocument

    const message =
      state.phase === "running"
        ? { ...compaction, status: "running" as const, time: { created: state.created } }
        : { ...compaction, time: { created: state.created } }

    return {
      ...compactionDocument,
      messages: [...prelude, message, ...(state.phase === "continued" && continuation ? [continuation] : [])],
      status: { type: state.phase === "continued" ? "idle" : "busy" },
    } satisfies SessionDocument
  })

  return (
    <section class="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-6">
      <div class="flex gap-3">
        <button type="button" onClick={start}>
          Replay
        </button>
      </div>
      <CurrentSessionProviders document={document()} backgroundCompaction>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

// `instant` arrives finished, as when started and ended land in one flush; `quick` ends inside the 400 ms grace.
const replayDurations = { instant: 0, quick: 150, short: 1_200, long: 20_000 }

export const CompactionReplay = {
  args: { run: "long" },
  argTypes: { run: { control: "select", options: Object.keys(replayDurations) } },
  render: (args: { run: string }) => (
    // SAFETY: the run control only offers replayDurations keys.
    <CompactionReplayStory duration={replayDurations[args.run as keyof typeof replayDurations]} />
  ),
}

export const CompactionFailed = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Compaction failed"
      description="A failed compaction keeps the production divider and shows the provider error."
      document={compactionFailedDocument}
      width="600px"
      backgroundCompaction
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
      backgroundCompaction
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

export const NoteAttachments = {
  render: () => {
    const [state, setState] = createStore({ selected: "None" })

    const notes = [
      { name: "Named", label: "button#save", title: "button#save", subtitle: "Browser annotation" },
      { name: "Unnamed", label: "button", title: "button.icon-only", subtitle: "Browser annotation", comment: " \t " },
      { name: "Legacy", label: "Legacy element" },
      { name: "Whitespace", label: "Fallback element", title: " \n ", subtitle: " \t " },
      { name: "Title only", label: "Original label", title: "button#save" },
      {
        name: "Commented",
        label: "Original selector",
        title: "Ignored title",
        subtitle: "Browser annotation",
        comment: "Fix this",
      },
      { name: "RTL subtitle", label: "زر الحفظ", title: "button#save", subtitle: "تعليق المتصفح", rtl: true },
      { name: "RTL legacy", label: "العنصر الأصلي", rtl: true },
      {
        name: "Long selector",
        label: 'main > section.settings-panel > form > button[data-action="save-all-account-preferences"]',
        title: 'main > section.settings-panel > form > button[data-action="save-all-account-preferences"]',
        subtitle: "Browser annotation",
      },
    ]

    return (
      <div style={{ padding: "24px", display: "flex", "flex-wrap": "wrap", gap: "24px", "max-width": "800px" }}>
        <For each={notes}>
          {(note) => (
            <section aria-label={note.name} dir={note.rtl ? "rtl" : "ltr"}>
              <h2 style={{ "font-size": "13px", "margin-bottom": "8px" }}>{note.name}</h2>
              <CommentCard
                target={commentCardTarget({ type: "note", icon: "code", ...note })}
                comment={note.comment ?? ""}
                tooltip
                onClick={() => setState("selected", note.name)}
              />
            </section>
          )}
        </For>
        <output aria-label="Selected attachment">{state.selected}</output>
      </div>
    )
  },
}

export const VoiceMessages = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Voice messages"
      description="A voice call's agent prompts on the user's behalf: its framing, or the user's spoken words, with a Voice badge on the bubble."
      document={voiceDocument}
      presentation={voicePresentation}
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
      description="A changed working directory renders as a timeline divider, truncates, and exposes its tooltip."
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
            previous: { providerID: "company-gateway", id: "long-context" },
            time: { created: 1_735_689_590_000 },
          },
          {
            id: "msg_story_fast_nano_default",
            type: "model-switched",
            model: { providerID: "company-gateway", id: "fast-nano" },
            previous: { providerID: "company-gateway", id: "fast-nano", variant: "xhigh" },
            time: { created: 1_735_689_590_100 },
          },
          {
            id: "msg_story_fast_nano_high",
            type: "model-switched",
            model: { providerID: "company-gateway", id: "fast-nano", variant: "high" },
            previous: { providerID: "company-gateway", id: "fast-nano" },
            time: { created: 1_735_689_590_200 },
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
                source: { type: "uri", uri: "src/a.ts" },
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

const UserMessageLinks = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Prompt with links"
      description="URLs in a prompt open externally; trailing punctuation and mentions stay plain text."
      document={{
        ...thinkingDocument,
        status: { type: "idle" },
        messages: [
          {
            id: "msg_story_user_links",
            type: "user",
            text: "set it up on this pc https://github.com/Hona/mesh, then compare @src/a.ts with (https://opencode.ai/docs).",
            agents: [],
            files: [
              {
                data: "",
                mime: "text/plain",
                name: "a.ts",
                source: { type: "uri", uri: "src/a.ts" },
                mention: { text: "@src/a.ts", start: 64, end: 73 },
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
  links: UserMessageLinks,
}

export const Conversation = {
  args: { scenario: "notices", mode: "compact", reasoning: "heading", tool: false, text: "" },
  argTypes: {
    scenario: { control: "select", options: Object.keys(conversationScenarios) },
    reasoning: { control: "select", options: ["none", "blank", "heading"] },
    mode: { control: "select", options: ["hidden", "compact", "full"] },
  },
  render: (args: { scenario: string; mode: ReasoningMode; reasoning: string; tool: boolean; text: string }) => {
    if (args.scenario === "reasoning") return <AgentReasoningStory {...args} />

    // SAFETY: the scenario control only offers conversationScenarios keys, and "reasoning" returned above.
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
