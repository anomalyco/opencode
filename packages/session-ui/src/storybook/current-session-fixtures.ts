import type {
  JsonValue,
  ModelRef,
  PermissionRequest,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
} from "@opencode-ai/client/promise"
import type { SessionDocument } from "../document"
import type { SessionUserPresentation } from "../timeline/session-timeline"

export const CURRENT_SESSION_ID = "session_current_story"
export const STORY_TIME = 1_735_689_600_000

const model = {
  id: "claude-sonnet-4",
  providerID: "anthropic",
  variant: "balanced",
} satisfies ModelRef

function user(id: string, text: string, offset: number): SessionMessageUser {
  return {
    id,
    type: "user",
    text,
    time: { created: STORY_TIME + offset },
    metadata: { agent: "build", model },
  }
}

function assistant(input: {
  id: string
  offset: number
  content: SessionMessageAssistant["content"]
  completed?: number
  error?: SessionMessageAssistant["error"]
  retry?: SessionMessageAssistant["retry"]
  agent?: string
}): SessionMessageAssistant {
  return {
    id: input.id,
    type: "assistant",
    agent: input.agent ?? "build",
    model,
    content: input.content,
    error: input.error,
    retry: input.retry,
    time: {
      created: STORY_TIME + input.offset,
      completed: input.completed === undefined ? undefined : STORY_TIME + input.completed,
    },
  }
}

function completedTool(input: {
  id: string
  name: string
  offset: number
  args: Record<string, JsonValue>
  output: string
  metadata?: Record<string, JsonValue>
}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: input.id,
    name: input.name,
    state: {
      status: "completed",
      input: input.args,
      content: [{ type: "text", text: input.output }],
      metadata: input.metadata,
    },
    time: {
      created: STORY_TIME + input.offset,
      ran: STORY_TIME + input.offset + 100,
      completed: STORY_TIME + input.offset + 900,
    },
  }
}

function runningTool(input: {
  id: string
  name: string
  offset: number
  args: Record<string, JsonValue>
  metadata?: Record<string, JsonValue>
}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: input.id,
    name: input.name,
    state: {
      status: "running",
      input: input.args,
      metadata: input.metadata ?? {},
    },
    time: { created: STORY_TIME + input.offset, ran: STORY_TIME + input.offset + 100 },
  }
}

function failedTool(input: {
  id: string
  name: string
  offset: number
  args: Record<string, JsonValue>
  message: string
  metadata?: Record<string, JsonValue>
}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: input.id,
    name: input.name,
    state: {
      status: "error",
      input: input.args,
      error: { type: "ToolExecutionError", message: input.message },
      metadata: input.metadata,
    },
    time: {
      created: STORY_TIME + input.offset,
      ran: STORY_TIME + input.offset + 100,
      completed: STORY_TIME + input.offset + 700,
    },
  }
}

function document(messages: SessionMessageInfo[], status: SessionStatus = { type: "idle" }): SessionDocument {
  return {
    sessionID: CURRENT_SESSION_ID,
    messages,
    status,
    diffs: [],
  }
}

export const emptySessionDocument = {
  sessionID: CURRENT_SESSION_ID,
  messages: [],
  status: { type: "idle" },
  diffs: [],
} satisfies SessionDocument

export const pendingAndQueuedDocument = document(
  [
    user("msg_user_done", "Summarize the current timeline implementation.", 1_000),
    assistant({
      id: "msg_assistant_done",
      offset: 2_000,
      completed: 4_500,
      content: [{ type: "text", text: "The timeline projects current Session messages into stable typed rows." }],
    }),
    user("msg_user_pending", "Add deterministic stories for the current Session UI.", 5_000),
  ] satisfies SessionMessageInfo[],
  { type: "busy" },
)

export const queuedPrompts = [
  { id: "inbox_queue_1", text: "Cover the compact terminal width." },
  { id: "inbox_queue_2", text: "Then verify the full Storybook build." },
] satisfies { id: string; text: string }[]

export const streamingDocument = document(
  [
    user("msg_user_stream", "Explain the projection while you implement it.", 10_000),
    assistant({
      id: "msg_assistant_stream",
      offset: 11_000,
      content: [
        {
          type: "reasoning",
          text: "## Checking the current contract\n\nThe assistant content is nested on each current Session message.",
          state: { phase: "streaming" },
          time: { created: STORY_TIME + 11_100 },
        },
        {
          type: "text",
          text: "I have the typed rows in place. Next I am checking the streaming presentation",
          state: { phase: "streaming" },
        },
      ],
    }),
  ] satisfies SessionMessageInfo[],
  { type: "busy" },
)

export const editThenTestDocument = document([
  user("msg_user_edit", "Change the status label and run the focused test.", 20_000),
  assistant({
    id: "msg_assistant_edit",
    offset: 21_000,
    completed: 27_000,
    content: [
      {
        type: "reasoning",
        text: "I will make the smallest edit, then run the test that covers this behavior.",
        time: { created: STORY_TIME + 21_100, completed: STORY_TIME + 21_600 },
      },
      completedTool({
        id: "tool_edit_status",
        name: "edit",
        offset: 22_000,
        args: {
          path: "src/status.ts",
          oldString: 'export const status = "Working"',
          newString: 'export const status = "Running checks"',
        },
        output: "Updated src/status.ts",
        metadata: {
          files: [
            {
              file: "src/status.ts",
              before: 'export const status = "Working"\n',
              after: 'export const status = "Running checks"\n',
              additions: 1,
              deletions: 1,
            },
          ],
        },
      }),
      completedTool({
        id: "tool_test_status",
        name: "bash",
        offset: 24_000,
        args: { command: "bun test src/status.test.ts" },
        output: "bun test v1.2.0\n\n1 pass\n0 fail\nRan 1 test across 1 file.",
        metadata: { exit: 0 },
      }),
      {
        type: "text",
        text: "Updated the label and verified the focused test. **1 test passed.**",
      },
    ],
  }),
] satisfies SessionMessageInfo[])

export const shellStatesDocument = document(
  [
    {
      id: "msg_shell_running",
      type: "shell",
      shellID: "shell_running",
      command: "bun run storybook --ci",
      status: "running",
      output: {
        output: "Starting Storybook manager...\nBuilding preview...",
        cursor: 49,
        size: 49,
        truncated: false,
      },
      time: { created: STORY_TIME + 30_000 },
    },
    {
      id: "msg_shell_failed",
      type: "shell",
      shellID: "shell_failed",
      command: "bun test src/missing.test.ts",
      status: "exited",
      exit: 1,
      output: {
        output: "error: Test file not found: src/missing.test.ts",
        cursor: 48,
        size: 48,
        truncated: false,
      },
      time: { created: STORY_TIME + 31_000, completed: STORY_TIME + 31_800 },
    },
  ] satisfies SessionMessageInfo[],
  { type: "busy" },
)

export const requestHistoryDocument = document([
  user("msg_user_requests", "Ask before changing the release target.", 40_000),
  assistant({
    id: "msg_assistant_requests",
    offset: 41_000,
    completed: 44_000,
    content: [
      completedTool({
        id: "tool_question_release",
        name: "question",
        offset: 41_500,
        args: {
          questions: [
            {
              question: "Which release target should I use?",
              header: "Target",
              options: [
                { label: "Canary", description: "Publish for internal validation" },
                { label: "Stable", description: "Publish to all users" },
              ],
            },
          ],
        },
        output: "Canary",
        metadata: { answers: [["Canary"]] },
      }),
      failedTool({
        id: "tool_permission_release",
        name: "bash",
        offset: 43_000,
        args: { command: "npm publish --tag canary" },
        message: "Permission was denied for npm publish --tag canary",
      }),
    ],
  }),
] satisfies SessionMessageInfo[])

export const retryDocument = document(
  [
    user("msg_user_retry", "Generate the migration notes.", 50_000),
    assistant({
      id: "msg_assistant_retry",
      offset: 51_000,
      content: [],
      retry: {
        attempt: 2,
        at: 1_900_000_000_000,
        error: { type: "ProviderRateLimitError", message: "Rate limit reached. Retrying with backoff." },
      },
    }),
  ] satisfies SessionMessageInfo[],
  { type: "busy" },
)

export const compactionDocument = document([
  user("msg_user_compact", "Continue the implementation after compacting context.", 60_000),
  assistant({
    id: "msg_assistant_before_compact",
    offset: 61_000,
    completed: 62_500,
    content: [{ type: "text", text: "I inspected the timeline and identified the current message boundary." }],
    error: { type: "ExecutionInterrupted", message: "Context compaction started" },
  }),
  {
    id: "msg_compaction_complete",
    type: "compaction",
    status: "completed",
    reason: "auto",
    summary: "The Session timeline now consumes current nested assistant content.",
    recent: "Add deterministic stories and verify Storybook.",
    time: { created: STORY_TIME + 63_000 },
  },
  assistant({
    id: "msg_assistant_after_compact",
    offset: 64_000,
    completed: 66_000,
    content: [{ type: "text", text: "Context restored. I continued from the durable Session messages." }],
  }),
] satisfies SessionMessageInfo[])

export const subagentDocument = document(
  [
    user("msg_user_subagent", "Delegate the fixture review and report the result.", 70_000),
    assistant({
      id: "msg_assistant_subagent",
      offset: 71_000,
      agent: "build",
      content: [
        completedTool({
          id: "tool_subagent_review",
          name: "subagent",
          offset: 71_500,
          args: { agent: "review", description: "Review current Session fixtures" },
          output: "The fixtures use fixed current protocol messages and nested tool states.",
          metadata: { sessionID: "session_child_review", status: "completed" },
        }),
        runningTool({
          id: "tool_subagent_tests",
          name: "task",
          offset: 73_000,
          args: { subagent_type: "test", description: "Check the Storybook scenarios" },
          metadata: { sessionId: "session_child_tests" },
        }),
      ],
    }),
  ] satisfies SessionMessageInfo[],
  { type: "busy" },
)

export const attachmentsAndCommentsDocument = document([
  {
    ...user("msg_user_attachments", "Use @review to check the attached layout and the selected lines.", 80_000),
    files: [
      {
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        mime: "image/png",
        name: "timeline-layout.png",
        source: { type: "inline" },
      },
      {
        data: "IyBTdG9yeWJvb2sgY2hlY2tsaXN0Cg==",
        mime: "text/markdown",
        name: "review-checklist.md",
        source: { type: "inline" },
        mention: { text: "@review-checklist.md", start: 32, end: 52 },
      },
    ],
    agents: [{ name: "review", mention: { text: "@review", start: 4, end: 11 } }],
  },
  assistant({
    id: "msg_assistant_attachments",
    offset: 81_000,
    completed: 83_000,
    content: [
      {
        type: "text",
        text: "The attachment and line comment both point to the narrow timeline spacing. I kept the correction local.",
      },
    ],
  }),
] satisfies SessionMessageInfo[])

export const attachmentsAndCommentsPresentation = {
  msg_user_attachments: {
    comments: [
      {
        path: "packages/session-ui/src/timeline/session-timeline.tsx",
        comment: "Keep the row readable at 360 px without changing the production component.",
        selection: { startLine: 238, endLine: 241 },
      },
    ],
  },
} satisfies Record<string, SessionUserPresentation>

export const revertDocument = document([
  user("msg_user_revert_base", "Add a compact Session summary.", 90_000),
  assistant({
    id: "msg_assistant_revert_base",
    offset: 91_000,
    completed: 93_000,
    content: [{ type: "text", text: "Added a compact summary with the current Session status." }],
  }),
  user("msg_user_revert_boundary", "Replace the summary with an animated dashboard.", 94_000),
  assistant({
    id: "msg_assistant_revert_boundary",
    offset: 95_000,
    completed: 98_000,
    content: [{ type: "text", text: "Created the dashboard draft. Use the user action menu to revert this boundary." }],
  }),
] satisfies SessionMessageInfo[])

const largeMessages = Array.from({ length: 16 }, (_, index) => {
  const offset = 110_000 + index * 5_000
  const userID = `msg_user_large_${String(index + 1).padStart(2, "0")}`
  const assistantID = `msg_assistant_large_${String(index + 1).padStart(2, "0")}`
  const context =
    index % 4 === 0
      ? [
          completedTool({
            id: `tool_read_large_${String(index + 1).padStart(2, "0")}`,
            name: "read",
            offset: offset + 1_500,
            args: { filePath: `src/feature-${index + 1}.ts`, offset: 1, limit: 80 },
            output: `export const feature${index + 1} = true`,
            metadata: { loaded: [`src/feature-${index + 1}.ts`] },
          }),
        ]
      : []
  return [
    user(userID, `Complete deterministic Session UI checkpoint ${index + 1}.`, offset),
    assistant({
      id: assistantID,
      offset: offset + 1_000,
      completed: offset + 3_500,
      content: [
        ...context,
        {
          type: "text",
          text: `Checkpoint ${index + 1} is complete. The message uses fixed protocol data and stable content.`,
        },
      ],
    }),
  ] satisfies SessionMessageInfo[]
}).flat()

export const largeCompletedDocument = {
  sessionID: CURRENT_SESSION_ID,
  messages: largeMessages,
  status: { type: "idle" },
  diffs: [
    {
      file: "packages/session-ui/src/timeline/session-timeline.stories.tsx",
      patch: "@@ -0,0 +1,16 @@",
      additions: 16,
      deletions: 0,
      status: "added",
    },
  ],
} satisfies SessionDocument

export const appSurfaceDocument = document([
  user("msg_user_surface", "Update the command label, run the test, and show the execution result.", 200_000),
  assistant({
    id: "msg_assistant_surface",
    offset: 201_000,
    completed: 208_000,
    content: [
      completedTool({
        id: "tool_surface_edit",
        name: "edit",
        offset: 202_000,
        args: {
          path: "src/commands.ts",
          oldString: 'label: "Run"',
          newString: 'label: "Run checks"',
        },
        output: "Updated src/commands.ts",
        metadata: {
          files: [
            {
              file: "src/commands.ts",
              before: 'export const command = { label: "Run" }\n',
              after: 'export const command = { label: "Run checks" }\n',
              additions: 1,
              deletions: 1,
            },
          ],
        },
      }),
      completedTool({
        id: "tool_surface_shell",
        name: "bash",
        offset: 204_000,
        args: { command: "bun test src/commands.test.ts" },
        output: "2 pass\n0 fail\nCompleted in 184ms",
        metadata: { exit: 0 },
      }),
      {
        type: "text",
        text: "## Execution result\n\nThe label is now **Run checks** and both command tests pass.",
      },
    ],
  }),
] satisfies SessionMessageInfo[])

export const activePermissionRequest = {
  id: "permission_publish_canary",
  sessionID: CURRENT_SESSION_ID,
  action: "bash",
  resources: ["npm publish --tag canary"],
  save: ["npm publish *"],
  source: { type: "tool", messageID: "msg_assistant_requests", id: "tool_permission_release" },
} satisfies PermissionRequest

export const activeQuestion = {
  header: "Release target",
  question: "Which release target should the next execution use?",
  options: ["Canary", "Stable"],
} satisfies { header: string; question: string; options: string[] }
