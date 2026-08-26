import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME } from "../storybook/current-session-fixtures"
import { CurrentSessionProviders, CurrentSessionTimelineStory } from "../storybook/current-session-story"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Notice projection",
  id: "current-session-notice-projection",
  component: SessionTimeline,
  parameters: { layout: "fullscreen" },
}

const user = { id: "msg_notice_user", type: "user", text: "Run it", time: { created: STORY_TIME } } as const
const assistant = {
  id: "msg_notice_assistant",
  type: "assistant",
  agent: "build",
  model: STORY_MODEL,
  content: [{ type: "text", text: "Working" }],
  time: { created: STORY_TIME + 1, completed: STORY_TIME + 2 },
} satisfies SessionMessageInfo

export const ProtocolNoticeOrder = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Current protocol notice order"
      description="Agent changes, completed delegated work, restart continuation, and loaded skills retain CLI order."
      document={{
        sessionID: CURRENT_SESSION_ID,
        status: { type: "idle" },
        diffs: [],
        messages: [
          user,
          { id: "msg_notice_agent", type: "agent-switched", agent: "explore", time: { created: STORY_TIME + 1 } },
          assistant,
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

function CompactionLifecycleStory() {
  const [state, setState] = createStore({ phase: "running", summary: "", second: false })
  const current = createMemo(() => {
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
      messages: [user, assistant, message, ...(state.second ? [cancelled] : [])],
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
      <CurrentSessionProviders document={current()}>
        <SessionTimeline document={current()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const CompactionLifecycle = { render: () => <CompactionLifecycleStory /> }

export const StreamingDelegation = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Streaming subagent delegation"
      description="An incomplete subagent input shows its compact delegating indicator without an empty task card."
      document={{
        sessionID: CURRENT_SESSION_ID,
        status: { type: "busy" },
        diffs: [],
        messages: [
          user,
          {
            ...assistant,
            content: [
              {
                type: "tool",
                id: "tool_notice_delegation",
                name: "subagent",
                state: { status: "streaming", input: "" },
                time: { created: STORY_TIME + 2 },
              },
            ],
            time: { created: STORY_TIME + 1 },
          },
        ],
      }}
    />
  ),
}

export const RequestedBackgroundWork = {
  render: () => (
    <CurrentSessionTimelineStory
      title="Requested background work"
      description="A running subagent does not receive its background label before the request completes."
      document={{
        sessionID: CURRENT_SESSION_ID,
        status: { type: "busy" },
        diffs: [],
        messages: [
          user,
          {
            ...assistant,
            content: [
              {
                type: "tool",
                id: "tool_notice_background",
                name: "subagent",
                state: {
                  status: "running",
                  input: { description: "Inspect code", background: true },
                  metadata: { status: "running" },
                },
                time: { created: STORY_TIME + 2, ran: STORY_TIME + 3 },
              },
            ],
            time: { created: STORY_TIME + 1 },
          },
        ],
      }}
    />
  ),
}
