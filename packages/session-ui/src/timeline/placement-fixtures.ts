import type { JsonValue, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { labTool } from "../lab/current-session-scenarios"
import { timelinePresets, type TimelineDetail } from "./detail"

// Turns and settings whose projected rows the placement tests pin for both timelines.

const assistant = (
  id: string,
  created: number,
  content: SessionMessageAssistant["content"],
): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created, completed: created },
})

const text = (value: string) => ({ type: "text" as const, text: value })

const thought = (value: string) => ({ type: "reasoning" as const, text: value, time: { created: 1, completed: 2 } })

const stopped = (
  id: string,
  name: string,
  input: Record<string, string | boolean>,
  error = { type: "aborted", message: "Tool execution interrupted" },
): SessionMessageAssistant["content"][number] => ({
  ...labTool(id, name, "error", input),
  state: { status: "error", input, error, metadata: {} },
})

const notice = (id: string, created: number, description: string, metadata: Record<string, JsonValue>) =>
  ({ id, type: "synthetic", text: description, description, metadata, time: { created } }) satisfies SessionMessageInfo

export const placementMessages: SessionMessageInfo[] = [
  { id: "msg_u1", type: "user", text: "explore and edit", time: { created: 1 } },
  assistant("msg_a1", 2, [
    thought("Looking around"),
    text("Let me look first."),
    labTool("read_1", "read", "completed", { path: "/repo/a.ts" }),
    labTool("read_2", "read", "completed", { path: "/repo/b.ts" }),
    labTool("read_img", "read", "completed", { path: "/repo/logo.png" }),
    labTool("grep_1", "grep", "completed", { pattern: "x" }),
    labTool("glob_1", "glob", "completed", { pattern: "*.ts" }),
    labTool("fetch_1", "webfetch", "completed", { url: "https://a.dev" }),
    labTool("search_1", "websearch", "completed", { query: "q" }),
    labTool("skill_1", "skill", "completed", { name: "review" }),
    text("Now editing."),
    labTool("edit_1", "edit", "completed", { path: "/repo/a.ts" }, { metadata: { files: [{ file: "/repo/a.ts" }] } }),
    labTool("write_1", "write", "completed", { path: "/repo/c.ts", content: "c" }),
    labTool(
      "patch_1",
      "patch",
      "completed",
      {},
      { metadata: { files: [{ file: "/repo/d.ts", status: "deleted" }] } },
    ),
    labTool("edit_err", "edit", "error", { path: "/repo/e.ts" }),
    labTool("todo_1", "todowrite", "completed", { todos: [] }),
    text("Done editing, here is the answer."),
  ]),
  { id: "msg_u2", type: "user", text: "run things", time: { created: 10 } },
  assistant("msg_a2", 11, [
    labTool("shell_1", "shell", "completed", { command: "ls" }, { metadata: { exit: 0 } }),
    labTool("shell_fail", "shell", "completed", { command: "false" }, { metadata: { exit: 1 } }),
    labTool(
      "shell_bg",
      "shell",
      "completed",
      { command: "sleep 5", background: true },
      {
        metadata: { shellID: "sh_1", status: "running" },
      },
    ),
    labTool(
      "sub_1",
      "subagent",
      "completed",
      { description: "look around", agent: "explore" },
      {
        metadata: { sessionID: "ses_child", status: "running" },
      },
    ),
    labTool("exec_1", "execute", "completed", { code: "1" }),
    labTool("question_1", "question", "completed", { questions: [] }),
    labTool("custom_1", "custom_tool", "completed", {}),
    labTool("custom_err", "custom_tool", "error", {}),
  ]),
  {
    id: "msg_n_shell",
    type: "synthetic",
    text: "Shell sleep 5 completed",
    description: "sleep 5",
    metadata: { source: "shell", shellID: "sh_1", state: "completed" },
    time: { created: 12 },
  },
  {
    id: "msg_n_sub",
    type: "synthetic",
    text: "result",
    description: "look around",
    metadata: { source: "subagent", agent: "explore", childID: "ses_child", state: "completed" },
    time: { created: 13 },
  },
  {
    id: "msg_n_plain",
    type: "synthetic",
    text: "Instructions updated",
    description: "Instructions updated",
    time: { created: 14 },
  },
  assistant("msg_a3", 15, [text("All done.")]),
  { id: "msg_u3", type: "user", text: "v1 tools", time: { created: 20 } },
  assistant("msg_a4", 21, [
    labTool("bash_1", "bash", "completed", { command: "ls" }, { metadata: { exit: 1 } }),
    labTool(
      "task_1",
      "task",
      "completed",
      { description: "old task", subagent_type: "general" },
      {
        metadata: { sessionID: "ses_old", status: "completed" },
      },
    ),
    labTool("apply_1", "apply_patch", "completed", {}, { metadata: { files: [{ file: "/repo/z.ts" }] } }),
    text("Old tools done."),
  ]),
  {
    id: "msg_shell",
    type: "shell",
    shellID: "shell_user",
    command: "pwd",
    status: "exited",
    exit: 0,
    output: { output: "/repo", cursor: 5, size: 5, truncated: false },
    time: { created: 30, completed: 31 },
  },
  { id: "msg_u5", type: "user", text: "background in a group", time: { created: 40 } },
  assistant("msg_a5", 41, [
    labTool("read_5", "read", "completed", { path: "/repo/f.ts" }),
    labTool(
      "shell_bg_2",
      "shell",
      "completed",
      { command: "make build", background: true },
      { metadata: { shellID: "sh_2", status: "running" } },
    ),
  ]),
  notice("msg_n_shell_2", 42, "make build", { source: "shell", shellID: "sh_2", state: "completed", exit: 0 }),
  assistant("msg_a5b", 43, [text("Built.")]),
  { id: "msg_u6", type: "user", text: "stopped calls", time: { created: 50 } },
  assistant("msg_a6", 51, [
    stopped("stop_empty", "shell", {}),
    stopped("stop_filled", "shell", { command: "git push" }),
    stopped("cancel_filled", "shell", { command: "npm test" }, { type: "unknown", message: "Command cancelled" }),
    stopped("cancel_empty", "shell", {}, { type: "unknown", message: "Command cancelled" }),
    stopped("stop_edit", "edit", { path: "/repo/g.ts" }),
    stopped("stop_custom", "custom_tool", {}),
    text("Stopped."),
  ]),
  { id: "msg_u7", type: "user", text: "failures", time: { created: 60 } },
  assistant("msg_a7", 61, [
    labTool("exec_err", "execute", "completed", { code: "x" }, { metadata: { error: true } }),
    labTool(
      "exec_calls",
      "execute",
      "completed",
      { code: "y" },
      { metadata: { toolCalls: [{ tool: "read", status: "error" }] } },
    ),
    labTool(
      "read_loaded",
      "read",
      "completed",
      { path: "/repo/h.ts" },
      { metadata: { loaded: ["/repo/AGENTS.md"] } },
    ),
    thought("Weighing it"),
    labTool("shell_timeout", "shell", "completed", { command: "sleep 99" }, { metadata: { timeout: true } }),
    text("Some failed."),
  ]),
  notice("msg_n_error", 62, "Background job failed", { state: "error" }),
  notice("msg_n_exit", 63, "make lint", { source: "shell", shellID: "sh_9", state: "completed", exit: 2 }),
  notice("msg_n_timeout", 64, "make slow", { source: "shell", shellID: "sh_8", state: "completed", timeout: true }),
  {
    id: "msg_shell_fail",
    type: "shell",
    shellID: "shell_user_fail",
    command: "false",
    status: "exited",
    exit: 1,
    output: { output: "", cursor: 0, size: 0, truncated: false },
    time: { created: 70, completed: 71 },
  },
  { id: "msg_u8", type: "user", text: "session events", time: { created: 80 } },
  { id: "msg_agent", type: "agent-switched", agent: "explore", time: { created: 81 } },
  { id: "msg_model", type: "model-switched", model: { id: "next", providerID: "provider" }, time: { created: 82 } },
  {
    id: "msg_moved",
    type: "location-switched",
    location: { directory: "/repo-worktree" },
    previous: { location: { directory: "/repo" } },
    time: { created: 83 },
  },
  notice("msg_goal", 84, "Ship it", { source: "goal" }),
  {
    id: "msg_compacted",
    type: "compaction",
    status: "completed",
    reason: "auto",
    summary: "summary",
    time: { created: 85 },
  },
  assistant("msg_a8", 86, [text("Switched.")]),
  { id: "msg_u9", type: "user", text: "compaction trouble", time: { created: 90 } },
  {
    id: "msg_compact_run",
    type: "compaction",
    status: "running",
    reason: "manual",
    summary: "",
    time: { created: 91 },
  },
  { id: "msg_u10", type: "user", text: "v1 failures", time: { created: 100 } },
  assistant("msg_a10", 101, [
    labTool("bash_err", "bash", "error", { command: "make" }),
    labTool(
      "bash_bg",
      "bash",
      "completed",
      { command: "serve", background: true },
      { metadata: { shellID: "sh_v1", status: "running" } },
    ),
    labTool("task_err", "task", "error", { description: "old failed", subagent_type: "general" }),
    labTool("apply_err", "apply_patch", "error", {}),
    text("Old failures."),
  ]),
  { id: "msg_u11", type: "user", text: "streaming", time: { created: 110 } },
  {
    id: "msg_a11",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 111 },
    content: [
      labTool("write_stream", "write", "streaming", {}, { raw: '{"path":"/repo/i.ts","content":"i' }),
      labTool("edit_stream", "edit", "streaming", {}, { raw: '{"path":"/repo/j.ts"' }),
      labTool("read_stream", "read", "streaming", {}, { raw: '{"path":"/repo/k.png"' }),
      labTool("shell_stream", "shell", "streaming", {}, { raw: '{"command":"ls","background":tr' }),
      labTool("exec_run", "execute", "running", { code: "z" }, { metadata: { toolCalls: [] } }),
      labTool("shell_run", "shell", "running", { command: "make" }, { output: "building" }),
      labTool("sub_run", "subagent", "running", { description: "dig", agent: "explore" }, { metadata: {} }),
      labTool("question_run", "question", "running", { questions: [] }),
      { type: "reasoning", text: "Still thinking", time: { created: 112 } },
    ],
  },
  { id: "msg_u12", type: "user", text: "script edits", time: { created: 120 } },
  {
    id: "msg_a12",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 121, completed: 121 },
    content: [
      labTool(
        "exec_files",
        "execute",
        "completed",
        { code: "await edit()" },
        {
          metadata: {
            toolCalls: [],
            files: [
              {
                file: "/repo/merged.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                patch: "--- a/repo/merged.ts\n+++ b/repo/merged.ts\n@@ -1 +1 @@\n-a\n+b\n",
              },
              {
                file: "/repo/merged.ts",
                status: "modified",
                additions: 2,
                deletions: 0,
                patch: "--- a/repo/merged.ts\n+++ b/repo/merged.ts\n@@ -1 +1,3 @@\n b\n+c\n+d\n",
              },
              {
                file: "/repo/created.ts",
                status: "added",
                additions: 1,
                deletions: 0,
                patch: "--- /dev/null\n+++ b/repo/created.ts\n@@ -0,0 +1 @@\n+new\n",
              },
              { file: "/repo/removed.bin", status: "deleted" },
            ],
          },
        },
      ),
      labTool("patch_2", "patch", "completed", {}, { metadata: { files: [{ file: "/repo/direct.ts" }] } }),
      { type: "text", text: "Script done." },
    ],
  },
  { id: "msg_u13", type: "user", text: "live script edits", time: { created: 130 } },
  {
    id: "msg_a13",
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    time: { created: 131 },
    content: [
      labTool(
        "exec_live",
        "execute",
        "running",
        { code: "await patch(); await write()" },
        {
          metadata: {
            background: true,
            toolCalls: [{ tool: "patch", status: "completed" }],
            files: [
              {
                file: "/repo/live.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                patch: "--- a/repo/live.ts\n+++ b/repo/live.ts\n@@ -1 +1 @@\n-a\n+b\n",
              },
            ],
          },
        },
      ),
    ],
  },
]

const preset = (id: string): TimelineDetail => timelinePresets.find((item) => item.id === id)!.value

export const placementDetails = {
  ...Object.fromEntries(timelinePresets.map((item): [string, TimelineDetail] => [item.id, item.value])),
  "edits grouped and collapsed": { ...preset("detailed"), edit: { placement: "grouped", details: "collapsed" } },
  "edits collapsed": { ...preset("everything"), edit: { placement: "separate", details: "collapsed" } },
  "commentary grouped": { ...preset("detailed"), commentary: { placement: "grouped" } },
  "commentary hidden": { ...preset("compact"), commentary: { placement: "hidden" } },
  "thinking grouped and expanded": { ...preset("detailed"), thinking: { placement: "grouped", details: "expanded" } },
  "notices and subagents hidden": {
    ...preset("detailed"),
    notices: { placement: "hidden" },
    subagents: { placement: "hidden" },
  },
  "shell and tools hidden": {
    ...preset("detailed"),
    shell: { placement: "hidden", details: "collapsed" },
    tools: { placement: "hidden" },
  },
} satisfies Record<string, TimelineDetail>

/** How the placement tests mark a part that starts open (`*`) or closed (`-`); unmarked, the row decides. */
export function openMark(open: boolean | undefined) {
  if (open === undefined) return ""

  return open ? "*" : "-"
}
