import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode/client/promise"
import type { SessionDocument } from "@opencode/session-ui/document"
import type { SessionUserPresentation } from "@opencode/session-ui/timeline"

const TIME = 1_789_171_200_000
const MODEL = { providerID: "lorem", id: "ipsum-2", variant: "balanced" }
const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "

function lorem(length: number) {
  return LOREM.repeat(Math.ceil(length / LOREM.length))
    .slice(0, length)
    .trimEnd()
}

function output(length: number) {
  const line = `${lorem(72)}\n`
  return line
    .repeat(Math.ceil(length / line.length))
    .slice(0, length)
    .trimEnd()
}

function user(id: string, text: string, offset: number): SessionMessageUser {
  return {
    id,
    type: "user",
    text,
    files: [],
    agents: [],
    skills: [],
    time: { created: TIME + offset },
    metadata: { agent: "build", model: MODEL },
  }
}

function assistant(input: {
  id: string
  offset: number
  content: SessionMessageAssistant["content"]
  finish?: SessionMessageAssistant["finish"]
  error?: SessionMessageAssistant["error"]
  retry?: SessionMessageAssistant["retry"]
  completed?: boolean
}): SessionMessageAssistant {
  return {
    id: input.id,
    type: "assistant",
    agent: "build",
    model: MODEL,
    content: input.content,
    finish: input.finish,
    error: input.error,
    retry: input.retry,
    time: {
      created: TIME + input.offset,
      ...(input.completed === false ? {} : { completed: TIME + input.offset + 1_200 }),
    },
  }
}

function reasoning(text: string, offset: number) {
  return {
    type: "reasoning",
    text,
    time: { created: TIME + offset, completed: TIME + offset + 500 },
  } satisfies SessionMessageAssistant["content"][number]
}

function completedTool(input: {
  id: string
  name: string
  offset: number
  args: Record<string, JsonValue>
  result: string
  metadata?: Record<string, JsonValue>
  files?: { uri: string; mime: string; name?: string }[]
}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: input.id,
    name: input.name,
    state: {
      status: "completed",
      input: input.args,
      content: [
        { type: "text", text: input.result },
        ...(input.files ?? []).map((file) => ({ type: "file" as const, ...file })),
      ],
      metadata: input.metadata,
    },
    time: { created: TIME + input.offset, ran: TIME + input.offset + 100, completed: TIME + input.offset + 900 },
  }
}

function errorTool(input: {
  id: string
  name: string
  offset: number
  args: Record<string, JsonValue>
  message: string
  metadata?: Record<string, JsonValue>
  result?: string
}): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: input.id,
    name: input.name,
    state: {
      status: "error",
      input: input.args,
      error: { type: "ToolExecutionError", message: input.message },
      content: input.result ? [{ type: "text", text: input.result }] : undefined,
      metadata: input.metadata,
    },
    time: { created: TIME + input.offset, ran: TIME + input.offset + 100, completed: TIME + input.offset + 700 },
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
    state: { status: "running", input: input.args, metadata: input.metadata ?? {} },
    time: { created: TIME + input.offset, ran: TIME + input.offset + 100 },
  }
}

function document(messages: SessionMessageInfo[], status: SessionDocument["status"] = { type: "idle" }) {
  return { sessionID: "session_real_timeline", messages, status, diffs: [] } satisfies SessionDocument
}

const representativeUser = {
  ...user("msg_real_user", lorem(1_440), 1_000),
  files: [
    {
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      mime: "image/png",
      name: "lorem-layout.png",
      source: { type: "inline" },
    },
  ],
  agents: [{ name: "review", mention: { text: "@review", start: 0, end: 7 } }],
} satisfies SessionMessageInfo

export const realTimelineDocument = document([
  representativeUser,
  assistant({
    id: "msg_real_skill",
    offset: 3_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(210), 3_050),
      completedTool({
        id: "tool_real_skill",
        name: "skill",
        offset: 3_300,
        args: { name: "lorem-guidance" },
        result: output(12_800),
        metadata: { name: "lorem-guidance" },
      }),
    ],
  }),
  assistant({
    id: "msg_real_read",
    offset: 5_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(190), 5_050),
      completedTool({
        id: "tool_real_read",
        name: "read",
        offset: 5_300,
        args: { path: "src/lorem/timeline-controller.tsx", offset: 1, limit: 240 },
        result: output(21_700),
        metadata: { loaded: ["src/lorem/timeline-controller.tsx"] },
      }),
    ],
  }),
  assistant({
    id: "msg_real_search",
    offset: 7_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(205), 7_050),
      completedTool({
        id: "tool_real_grep",
        name: "grep",
        offset: 7_300,
        args: { pattern: "lorem", path: "src", include: "*.tsx" },
        result: output(3_500),
        metadata: { matches: 18 },
      }),
      completedTool({
        id: "tool_real_glob",
        name: "glob",
        offset: 7_500,
        args: { pattern: "src/**/*.tsx" },
        result: output(1_800),
        metadata: { count: 42 },
      }),
    ],
  }),
  assistant({
    id: "msg_real_code",
    offset: 9_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(180), 9_050),
      completedTool({
        id: "tool_real_execute",
        name: "execute",
        offset: 9_300,
        args: { code: "const result = await tools.lorem.inspect({ limit: 24 })\nreturn result" },
        result: output(6_300),
        metadata: {
          toolCalls: [
            { name: "lorem.inspect", status: "completed" },
            { name: "lorem.measure", status: "completed" },
          ],
        },
      }),
    ],
  }),
  assistant({
    id: "msg_real_shell",
    offset: 11_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(195), 11_050),
      completedTool({
        id: "tool_real_shell",
        name: "shell",
        offset: 11_300,
        args: { command: "bun test src/lorem/timeline.test.ts" },
        result: output(4_700),
        metadata: { exit: 0 },
      }),
    ],
  }),
  assistant({
    id: "msg_real_web",
    offset: 13_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(200), 13_050),
      completedTool({
        id: "tool_real_websearch",
        name: "websearch",
        offset: 13_300,
        args: { query: "lorem ipsum timeline guidance" },
        result: output(16_500),
        metadata: { provider: "lorem" },
      }),
      completedTool({
        id: "tool_real_webfetch",
        name: "webfetch",
        offset: 13_500,
        args: { url: "https://example.com/lorem" },
        result: output(15_100),
      }),
    ],
  }),
  {
    id: "msg_real_system",
    type: "system",
    text: lorem(920),
    description: "Instructions updated: lorem/timeline",
    time: { created: TIME + 15_000 },
  },
  assistant({
    id: "msg_real_edit",
    offset: 16_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(185), 16_050),
      completedTool({
        id: "tool_real_patch",
        name: "patch",
        offset: 16_300,
        args: { patchText: lorem(3_200) },
        result: lorem(190),
        metadata: {
          files: [
            {
              file: "src/lorem/real-timeline.tsx",
              status: "modified",
              patch: "@@ -1 +1 @@\n-export const lorem = false\n+export const lorem = true",
              additions: 1,
              deletions: 1,
            },
          ],
        },
      }),
    ],
  }),
  assistant({
    id: "msg_real_subagent",
    offset: 18_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(200), 18_050),
      completedTool({
        id: "tool_real_subagent",
        name: "subagent",
        offset: 18_300,
        args: { agent: "explore", description: "Lorem ipsum audit", prompt: lorem(1_400) },
        result: lorem(480),
        metadata: { sessionID: "session_lorem_child", status: "completed" },
      }),
    ],
  }),
  {
    id: "msg_real_background_complete",
    type: "synthetic",
    text: lorem(8_900),
    description: "Background task “Lorem ipsum audit” completed",
    metadata: {
      source: "subagent",
      state: "completed",
      childID: "session_lorem_child",
      agent: "explore",
    },
    time: { created: TIME + 20_000 },
  },
  assistant({
    id: "msg_real_result",
    offset: 21_000,
    finish: "stop",
    content: [reasoning(lorem(160), 21_050), { type: "text", text: lorem(560) }],
  }),
  { id: "msg_real_idle", type: "idle", outcome: "succeeded", time: { created: TIME + 23_000 } },
] satisfies SessionMessageInfo[])

export const realTimelinePresentation = {
  msg_real_user: {
    displayText: lorem(420),
    comments: [
      {
        path: "src/lorem/timeline-controller.tsx",
        comment: lorem(180),
        selection: { startLine: 118, endLine: 126 },
      },
    ],
  },
} satisfies Record<string, SessionUserPresentation>

const coveragePrelude = [
  user("msg_coverage_user", lorem(620), 30_000),
  {
    id: "msg_coverage_agent",
    type: "agent-switched",
    agent: "review",
    previous: "build",
    time: { created: TIME + 31_000 },
  },
  {
    id: "msg_coverage_model",
    type: "model-switched",
    model: { providerID: "lorem", id: "ipsum-3" },
    previous: MODEL,
    time: { created: TIME + 31_500 },
  },
  {
    id: "msg_coverage_location",
    type: "location-switched",
    location: { directory: "/workspace/lorem/ipsum/dolor/sit/amet" },
    projectID: "project_lorem",
    subpath: "packages/timeline",
    previous: {
      location: { directory: "/workspace/lorem" },
      projectID: "project_previous",
      subpath: "packages/app",
    },
    time: { created: TIME + 32_000 },
  },
  {
    id: "msg_coverage_skill",
    type: "skill",
    skill: "skill_lorem",
    name: "lorem-audit",
    text: lorem(12_800),
    time: { created: TIME + 32_500 },
  },
  {
    id: "msg_coverage_system",
    type: "system",
    text: lorem(2_400),
    description: "Lorem ipsum system notice",
    time: { created: TIME + 33_000 },
  },
  {
    id: "msg_coverage_synthetic_blank",
    type: "synthetic",
    text: lorem(240),
    description: "   ",
    time: { created: TIME + 33_500 },
  },
] satisfies SessionMessageInfo[]

export const realTimelineCoverageDocument = document([
  ...coveragePrelude,
  {
    id: "msg_coverage_shell_success",
    type: "shell",
    shellID: "shell_lorem_success",
    command: "bun test src/lorem",
    status: "exited",
    exit: 0,
    output: { output: output(4_700), cursor: 4_700, size: 4_700, truncated: false },
    time: { created: TIME + 34_000, completed: TIME + 35_000 },
  },
  {
    id: "msg_coverage_shell_timeout",
    type: "shell",
    shellID: "shell_lorem_timeout",
    command: "bun run lorem:slow",
    status: "timeout",
    exit: 124,
    output: { output: output(2_000), cursor: 2_000, size: 2_000, truncated: true },
    time: { created: TIME + 36_000, completed: TIME + 38_000 },
  },
  {
    id: "msg_coverage_shell_killed",
    type: "shell",
    shellID: "shell_lorem_killed",
    command: "bun run lorem:cancelled",
    status: "killed",
    exit: 137,
    output: { output: output(1_200), cursor: 1_200, size: 1_200, truncated: false },
    time: { created: TIME + 38_100, completed: TIME + 38_600 },
  },
  {
    id: "msg_coverage_shell_failed",
    type: "shell",
    shellID: "shell_lorem_failed",
    command: "bun test src/lorem/failing.test.ts",
    status: "exited",
    exit: 1,
    output: { output: output(1_800), cursor: 1_800, size: 1_800, truncated: false },
    time: { created: TIME + 38_700, completed: TIME + 38_900 },
  },
  assistant({
    id: "msg_coverage_streaming",
    offset: 39_000,
    completed: false,
    content: [
      { type: "reasoning", text: lorem(200), time: { created: TIME + 39_050 } },
      {
        type: "tool",
        id: "tool_coverage_streaming",
        name: "webfetch",
        state: { status: "streaming", input: '{"url":"https://example.com/lorem' },
        time: { created: TIME + 39_300 },
      },
    ],
  }),
  assistant({
    id: "msg_coverage_running",
    offset: 41_000,
    completed: false,
    content: [
      runningTool({
        id: "tool_coverage_background_shell",
        name: "shell",
        offset: 41_300,
        args: { command: "bun run lorem:background" },
        metadata: { shellID: "shell_lorem_background", status: "running", output: output(900) },
      }),
      runningTool({
        id: "tool_coverage_background_agent",
        name: "subagent",
        offset: 41_500,
        args: { agent: "general", description: "Lorem background", prompt: lorem(700) },
        metadata: { sessionID: "session_lorem_background", status: "running" },
      }),
    ],
  }),
  assistant({
    id: "msg_coverage_question",
    offset: 43_000,
    finish: "tool-calls",
    content: [
      completedTool({
        id: "tool_coverage_question",
        name: "question",
        offset: 43_300,
        args: { questions: [{ header: "Lorem", question: lorem(120), options: ["Ipsum", "Dolor"] }] },
        result: "Ipsum",
        metadata: { answers: [["Ipsum"]] },
      }),
      completedTool({
        id: "tool_coverage_file_result",
        name: "browser",
        offset: 43_500,
        args: { action: "screenshot" },
        result: lorem(120),
        files: [{ uri: "data:image/png;base64,iVBORw0KGgo=", mime: "image/png", name: "lorem.png" }],
      }),
    ],
  }),
  assistant({
    id: "msg_coverage_native",
    offset: 45_000,
    finish: "tool-calls",
    content: [
      completedTool({
        id: "tool_coverage_native_read",
        name: "read",
        offset: 45_200,
        args: { path: "src/lorem/native.ts" },
        result: output(2_200),
      }),
      completedTool({
        id: "tool_coverage_native_shell",
        name: "shell",
        offset: 45_400,
        args: { command: "bun test src/lorem/native.test.ts" },
        result: "1 pass\n0 fail",
        metadata: { exit: 0 },
      }),
    ],
  }),
  assistant({
    id: "msg_coverage_code_mode",
    offset: 47_000,
    finish: "tool-calls",
    content: [
      completedTool({
        id: "tool_coverage_code_mode",
        name: "execute",
        offset: 47_300,
        args: {
          code: "const data = await tools.read({ path: 'src/lorem/code.ts' })\nreturn tools.shell({ command: 'bun test' })",
        },
        result: output(6_300),
        metadata: {
          toolCalls: [
            { name: "read", status: "completed" },
            { name: "shell", status: "error" },
          ],
        },
      }),
    ],
  }),
  assistant({
    id: "msg_coverage_tool_error",
    offset: 49_000,
    finish: "tool-calls",
    content: [
      errorTool({
        id: "tool_coverage_error",
        name: "mcp_lorem_lookup",
        offset: 49_300,
        args: { query: lorem(160) },
        message: lorem(320),
        result: lorem(180),
        metadata: { provider: "lorem" },
      }),
      errorTool({
        id: "tool_coverage_todo_error",
        name: "todo",
        offset: 49_500,
        args: { todos: [{ content: lorem(80), status: "pending" }] },
        message: lorem(240),
      }),
    ],
  }),
  {
    id: "msg_coverage_shell_notice",
    type: "synthetic",
    text: output(8_900),
    description: "Background shell “Lorem ipsum” failed",
    metadata: { source: "shell", state: "completed", shellID: "shell_lorem_background", exit: 1, truncated: false },
    time: { created: TIME + 51_000 },
  },
  {
    id: "msg_coverage_subagent_cancelled",
    type: "synthetic",
    text: lorem(1_200),
    description: "Background task “Lorem cancelled” was cancelled",
    metadata: { source: "subagent", state: "cancelled", childID: "session_lorem_cancelled", agent: "general" },
    time: { created: TIME + 51_200 },
  },
  {
    id: "msg_coverage_subagent_error",
    type: "synthetic",
    text: lorem(1_400),
    description: "Background task “Lorem failed” failed",
    metadata: { source: "subagent", state: "error", childID: "session_lorem_failed", agent: "general" },
    time: { created: TIME + 51_400 },
  },
  assistant({
    id: "msg_coverage_interrupted",
    offset: 52_000,
    finish: "error",
    error: { type: "ExecutionInterrupted", message: "Lorem ipsum interrupted" },
    content: [{ type: "text", text: lorem(280) }],
  }),
  assistant({
    id: "msg_coverage_error",
    offset: 54_000,
    finish: "error",
    error: { type: "provider.invalid-output", message: lorem(360) },
    content: [],
  }),
  assistant({
    id: "msg_coverage_retry",
    offset: 56_000,
    completed: false,
    retry: {
      attempt: 3,
      at: TIME + 56_500,
      error: { type: "provider.internal", message: lorem(420) },
    },
    content: [],
  }),
  {
    id: "msg_coverage_compaction_running",
    type: "compaction",
    status: "running",
    reason: "auto",
    summary: lorem(18_000),
    recent: lorem(107_000),
    time: { created: TIME + 58_000 },
  },
  {
    id: "msg_coverage_compaction_complete",
    type: "compaction",
    status: "completed",
    reason: "manual",
    model: MODEL,
    summary: lorem(18_000),
    recent: lorem(107_000),
    providerContext: {
      version: 1,
      provenance: {
        providerID: "lorem",
        provider: "Lorem",
        modelID: "ipsum-2",
        route: "lorem-route",
        protocol: "lorem-protocol",
        endpoint: "lorem-endpoint-digest",
      },
      messages: [],
    },
    cost: 0.012,
    tokens: { input: 3_200, output: 420, reasoning: 90, cache: { read: 8_700, write: 0 } },
    time: { created: TIME + 60_000 },
  },
  {
    id: "msg_coverage_compaction_failed",
    type: "compaction",
    status: "failed",
    reason: "auto",
    error: { type: "compaction.failed", message: lorem(320) },
    cost: 0.004,
    tokens: { input: 1_200, output: 90, reasoning: 20, cache: { read: 2_100, write: 0 } },
    time: { created: TIME + 60_500 },
  },
  {
    id: "msg_coverage_compaction_interrupted",
    type: "compaction",
    status: "failed",
    reason: "manual",
    error: { type: "compaction.interrupted", message: "Lorem ipsum compaction interrupted" },
    time: { created: TIME + 61_000 },
  },
  assistant({
    id: "msg_coverage_recovered",
    offset: 62_000,
    finish: "stop",
    content: [{ type: "text", text: lorem(560) }],
  }),
  { id: "msg_coverage_idle", type: "idle", outcome: "interrupted", time: { created: TIME + 64_000 } },
] satisfies SessionMessageInfo[])

export const realTimelineFailureDocument = document([
  user("msg_failure_user", lorem(420), 70_000),
  assistant({
    id: "msg_failure_tools",
    offset: 71_000,
    finish: "tool-calls",
    content: [
      errorTool({
        id: "tool_failure_hidden",
        name: "grep",
        offset: 71_200,
        args: { pattern: "lorem", path: "src" },
        message: lorem(360),
      }),
      errorTool({
        id: "tool_failure_todo",
        name: "todo",
        offset: 71_400,
        args: { todos: [{ content: lorem(120), status: "pending" }] },
        message: lorem(280),
      }),
    ],
  }),
  {
    id: "msg_failure_required_notice",
    type: "synthetic",
    text: lorem(900),
    description: "Background shell failed",
    metadata: { source: "shell", state: "completed", shellID: "shell_failure", exit: 1 },
    time: { created: TIME + 73_000 },
  },
  assistant({
    id: "msg_failure_assistant",
    offset: 74_000,
    finish: "error",
    error: { type: "provider.invalid-output", message: lorem(420) },
    content: [],
  }),
] satisfies SessionMessageInfo[])

export const realTimelineVerboseDocument = document([
  {
    ...user("msg_verbose_user", lorem(24_500), 80_000),
    files: [
      {
        data: "IyBMb3JlbSBpcHN1bQ==",
        mime: "text/markdown",
        name: `${lorem(110).replaceAll(" ", "-")}.md`,
        source: { type: "inline" },
      },
      {
        data: "JVBERi0xLjQK",
        mime: "application/pdf",
        name: "lorem-verbose.pdf",
        source: { type: "inline" },
      },
    ],
  },
  assistant({
    id: "msg_verbose_assistant",
    offset: 82_000,
    finish: "tool-calls",
    content: [
      reasoning(lorem(1_100), 82_050),
      completedTool({
        id: "tool_verbose_read",
        name: "read",
        offset: 82_300,
        args: { path: `/workspace/${lorem(220).replaceAll(" ", "/")}/timeline.tsx`, offset: 1, limit: 2_000 },
        result: output(106_000),
      }),
      errorTool({
        id: "tool_verbose_error",
        name: "mcp_lorem_extremely_verbose_tool_name_for_overflow_validation",
        offset: 82_500,
        args: { query: lorem(500) },
        message: lorem(670),
      }),
    ],
  }),
  assistant({
    id: "msg_verbose_result",
    offset: 84_000,
    finish: "stop",
    content: [{ type: "text", text: lorem(28_000) }],
  }),
] satisfies SessionMessageInfo[])
