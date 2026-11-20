import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { storyTool } from "../storybook/current-session-scenarios"
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

export const placementMessages: SessionMessageInfo[] = [
  { id: "msg_u1", type: "user", text: "explore and edit", time: { created: 1 } },
  assistant("msg_a1", 2, [
    thought("Looking around"),
    text("Let me look first."),
    storyTool("read_1", "read", "completed", { path: "/repo/a.ts" }),
    storyTool("read_2", "read", "completed", { path: "/repo/b.ts" }),
    storyTool("read_img", "read", "completed", { path: "/repo/logo.png" }),
    storyTool("grep_1", "grep", "completed", { pattern: "x" }),
    storyTool("glob_1", "glob", "completed", { pattern: "*.ts" }),
    storyTool("fetch_1", "webfetch", "completed", { url: "https://a.dev" }),
    storyTool("search_1", "websearch", "completed", { query: "q" }),
    storyTool("skill_1", "skill", "completed", { name: "review" }),
    text("Now editing."),
    storyTool("edit_1", "edit", "completed", { path: "/repo/a.ts" }, { metadata: { files: [{ file: "/repo/a.ts" }] } }),
    storyTool("write_1", "write", "completed", { path: "/repo/c.ts", content: "c" }),
    storyTool(
      "patch_1",
      "patch",
      "completed",
      {},
      { metadata: { files: [{ file: "/repo/d.ts", status: "deleted" }] } },
    ),
    storyTool("edit_err", "edit", "error", { path: "/repo/e.ts" }),
    storyTool("todo_1", "todowrite", "completed", { todos: [] }),
    text("Done editing, here is the answer."),
  ]),
  { id: "msg_u2", type: "user", text: "run things", time: { created: 10 } },
  assistant("msg_a2", 11, [
    storyTool("shell_1", "shell", "completed", { command: "ls" }, { metadata: { exit: 0 } }),
    storyTool("shell_fail", "shell", "completed", { command: "false" }, { metadata: { exit: 1 } }),
    storyTool(
      "shell_bg",
      "shell",
      "completed",
      { command: "sleep 5", background: true },
      {
        metadata: { shellID: "sh_1", status: "running" },
      },
    ),
    storyTool(
      "sub_1",
      "subagent",
      "completed",
      { description: "look around", agent: "explore" },
      {
        metadata: { sessionID: "ses_child", status: "running" },
      },
    ),
    storyTool("exec_1", "execute", "completed", { code: "1" }),
    storyTool("question_1", "question", "completed", { questions: [] }),
    storyTool("custom_1", "custom_tool", "completed", {}),
    storyTool("custom_err", "custom_tool", "error", {}),
  ]),
  {
    id: "msg_n_shell",
    type: "synthetic",
    text: "Shell sleep 5 completed",
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
  { id: "msg_n_plain", type: "synthetic", text: "Instructions updated", time: { created: 14 } },
  assistant("msg_a3", 15, [text("All done.")]),
  { id: "msg_u3", type: "user", text: "v1 tools", time: { created: 20 } },
  assistant("msg_a4", 21, [
    storyTool("bash_1", "bash", "completed", { command: "ls" }, { metadata: { exit: 1 } }),
    storyTool(
      "task_1",
      "task",
      "completed",
      { description: "old task", subagent_type: "general" },
      {
        metadata: { sessionID: "ses_old", status: "completed" },
      },
    ),
    storyTool("apply_1", "apply_patch", "completed", {}, { metadata: { files: [{ file: "/repo/z.ts" }] } }),
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
]

const preset = (id: string): TimelineDetail => timelinePresets.find((item) => item.id === id)!.value

export const placementDetails = {
  ...Object.fromEntries(timelinePresets.map((item): [string, TimelineDetail] => [item.id, item.value])),
  "edits grouped and collapsed": { ...preset("detailed"), edit: { placement: "grouped", details: "collapsed" } },
  "edits collapsed": { ...preset("everything"), edit: { placement: "separate", details: "collapsed" } },
  "commentary grouped": { ...preset("detailed"), commentary: { placement: "grouped" } },
  "commentary hidden": { ...preset("compact"), commentary: { placement: "hidden" } },
  "shell and tools hidden": {
    ...preset("detailed"),
    shell: { placement: "hidden", details: "collapsed" },
    tools: { placement: "hidden" },
  },
} satisfies Record<string, TimelineDetail>
