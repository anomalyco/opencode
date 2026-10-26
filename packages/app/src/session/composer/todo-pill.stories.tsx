import type { SessionMessageInfo } from "@opencode/client/promise"
import type { SessionDocument } from "@opencode/session-ui/document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME, editThenTestDocument } from "@opencode/session-ui/storybook"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { createMemo, onMount } from "solid-js"
import { SessionPreview } from "@/session/story-model"
import type { SessionActivityItem } from "./activity-chips"
import { sessionTodos, type Todo } from "./todos"

const timelineDetail = timelinePresets[2].value

const plan = [
  "Read the activity pill and the composer lane",
  "Derive todos from the latest todowrite call",
  "Share one lane between the activity and todo pills",
  "Build the todo pill",
  "Add a story for the todo pill",
  "Check RTL and the right-aligned lane",
  "Run the app typecheck",
]

// `progress` todos are done, the next one is in progress and the rest are pending.
const todosAt = (progress: number): Todo[] =>
  plan.map((content, index) => ({
    content,
    status: index < progress ? "completed" : index === progress ? "in_progress" : "pending",
  }))

const activity: { subagents: SessionActivityItem[]; shells: SessionActivityItem[] } = {
  subagents: [
    {
      key: "ses_child_audit",
      type: "subagent",
      label: "Audit the composer lane",
      agent: "explore",
      sessionID: "ses_child_audit",
      target: "ses_child_audit",
      started: Date.now() - 42_000,
    },
  ],
  shells: [
    {
      key: "shl_dev",
      type: "shell",
      label: "bun run dev -- --port 4444",
      target: "shl_dev",
      started: Date.now() - 341_000,
    },
  ],
}

function document(todos: Todo[]): SessionDocument {
  const messages: SessionMessageInfo[] = [
    ...editThenTestDocument.messages,
    {
      id: "msg_user_todos",
      type: "user",
      text: "Bring the todo list back as a floating pill above the composer.",
      time: { created: STORY_TIME + 300_000 },
      metadata: { agent: "build", model: STORY_MODEL },
    },
    {
      id: "msg_assistant_todos",
      type: "assistant",
      agent: "build",
      model: STORY_MODEL,
      content: [
        { type: "text", text: "I'll plan the work, then build the pill next to the activity capsule." },
        {
          type: "tool",
          id: "tool_todowrite",
          name: "todowrite",
          state: {
            status: "completed",
            input: { todos },
            content: [{ type: "text", text: "Todos updated" }],
            metadata: { todos },
          },
          time: { created: STORY_TIME + 301_000, ran: STORY_TIME + 301_100 },
        },
      ],
      time: { created: STORY_TIME + 300_500 },
    },
  ]

  return { sessionID: CURRENT_SESSION_ID, messages, status: { type: "busy" }, diffs: [] }
}

type PreviewArgs = { progress: number; open: boolean; activity: boolean }

function Preview(props: PreviewArgs) {
  const value = createMemo(() => document(todosAt(props.progress)))

  onMount(() =>
    setTimeout(() => {
      const timeline = window.document.querySelector('[data-slot="story-timeline"]')
      timeline?.scrollTo({ top: timeline.scrollHeight })
    }, 150),
  )

  return (
    <SessionPreview
      title="Bring back the todo dock"
      description="opencode · todo pill"
      document={value()}
      timelineDetail={timelineDetail}
      activity={props.activity ? activity : undefined}
      todos={{ items: sessionTodos(value().messages), open: props.open }}
    />
  )
}

export default {
  title: "OpenCode/Session/Todo pill",
  id: "session-todo-pill",
  render: (args: PreviewArgs) => <Preview {...args} />,
  args: { progress: 3, open: false, activity: true },
  argTypes: {
    progress: { control: { type: "range", min: 0, max: 7, step: 1 } },
    open: { control: { type: "boolean" } },
    activity: { control: { type: "boolean" } },
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The latest todowrite plan as a capsule in the composer lane, beside the background activity capsule.",
      },
    },
  },
}

export const Collapsed = {}

export const Open = { args: { open: true } }

export const WithoutActivity = { args: { activity: false } }
