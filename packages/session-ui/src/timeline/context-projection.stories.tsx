import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME, thinkingDocument } from "../storybook/current-session-fixtures"
import { SessionTimeline } from "./session-timeline"

export default {
  title: "OpenCode/Conversation/Context projection",
  id: "current-session-context-projection",
  component: SessionTimeline,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Interactive context-group state transitions through the real production timeline.",
      },
    },
  },
}

function ContextStatusStory() {
  const [state, setState] = createStore({ read: false, glob: false })
  const tool = (name: "read" | "glob", completed: boolean) => {
    const input = name === "read" ? { path: "src/a.ts", offset: 0, limit: 120 } : { path: ".", pattern: "**/*.ts" }
    return {
      type: "tool",
      id: `tool_context_${name}`,
      name,
      state: completed
        ? { status: "completed", input, content: [{ type: "text", text: "Complete" }], metadata: {} }
        : { status: "running", input, metadata: {} },
      time: {
        created: STORY_TIME,
        ran: STORY_TIME + 100,
        ...(completed ? { completed: STORY_TIME + 200 } : {}),
      },
    } satisfies SessionMessageAssistantTool
  }
  const document = createMemo(
    () =>
      ({
        sessionID: CURRENT_SESSION_ID,
        messages: [
          ...thinkingDocument.messages,
          {
            id: "msg_context_projection_assistant",
            type: "assistant",
            agent: "build",
            model: STORY_MODEL,
            content: [tool("read", state.read), tool("glob", state.glob)],
            time: {
              created: STORY_TIME,
              ...(state.read && state.glob ? { completed: STORY_TIME + 300 } : {}),
            },
          } satisfies SessionMessageAssistant,
        ],
        status: { type: state.read && state.glob ? "idle" : "busy" },
        diffs: [],
      }) satisfies SessionDocument,
  )

  return (
    <section class="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-6">
      <div class="flex gap-2">
        <button type="button" onClick={() => setState("read", true)}>
          Complete read
        </button>
        <button type="button" onClick={() => setState("glob", true)}>
          Complete glob
        </button>
      </div>
      <CurrentSessionProviders document={document()}>
        <SessionTimeline document={document()} />
      </CurrentSessionProviders>
    </section>
  )
}

export const CollapsedDuringStatusUpdates = { render: () => <ContextStatusStory /> }
export const CompletedGerman = { globals: { locale: "de" }, render: () => <ContextStatusStory /> }
export const CompletedArabic = { globals: { locale: "ar" }, render: () => <ContextStatusStory /> }
