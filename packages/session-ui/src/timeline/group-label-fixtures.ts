import type { SessionMessageAssistantReasoning, SessionMessageAssistantTool } from "@opencode/client/promise"
import { storyTool } from "../storybook/current-session-scenarios"

// Representative groups whose labels the timeline tests pin.

type Outcome = {
  type: "event"
  id: string
  event: { id: string; verb: "finished" | "stopped"; kind: "shell"; failed: boolean; shellID: string; title: string }
}

export type GroupFixturePart =
  | SessionMessageAssistantTool
  | (SessionMessageAssistantReasoning & { id: string })
  | Outcome

const thought = (id: string): GroupFixturePart => ({ type: "reasoning", id, text: "hmm", time: { created: 1 } })

const tool = storyTool

const shellOutcome = (id: string, shellID: string, verb: "finished" | "stopped", failed = false): Outcome => ({
  type: "event",
  id,
  event: { id, verb, kind: "shell", failed, shellID, title: "sleep 5" },
})

export const labelGroups = {
  "reads and searches": [
    tool("r1", "read", "completed", { path: "/repo/a.ts" }),
    tool("r2", "read", "completed", { path: "/repo/a.ts", offset: 10 }),
    tool("r3", "read", "completed", { path: "/repo/b.ts" }),
    tool("g1", "grep", "completed", { pattern: "x" }),
    tool("g2", "glob", "completed", { pattern: "*.ts" }),
    tool("w1", "webfetch", "completed", { url: "https://a.dev" }),
    tool("w2", "websearch", "completed", { query: "q" }),
  ],
  "one edit": [tool("e1", "edit", "completed", { path: "/repo/a.ts", oldString: "a", newString: "b" })],
  edits: [
    tool("e1", "edit", "completed", { path: "/repo/a.ts", oldString: "a", newString: "b" }),
    tool("e2", "write", "completed", { path: "/repo/b.ts", content: "b" }),
    tool(
      "e3",
      "patch",
      "completed",
      { patchText: "" },
      {
        metadata: { files: [{ file: "/repo/c.ts" }, { file: "/repo/a.ts" }] },
      },
    ),
    tool("r1", "read", "completed", { path: "/repo/d.ts" }),
  ],
  "shells with background outcomes": [
    tool("s1", "shell", "completed", { command: "ls" }),
    tool("s2", "shell", "completed", { command: "sleep 5", background: true }, { metadata: { shellID: "sh_1" } }),
    tool("s3", "shell", "completed", { command: "sleep 9", background: true }, { metadata: { shellID: "sh_2" } }),
    shellOutcome("n1", "sh_1", "finished"),
    shellOutcome("n2", "sh_3", "stopped"),
  ],
  "background outcomes only": [shellOutcome("n1", "sh_1", "finished", true), shellOutcome("n2", "sh_2", "finished")],
  "mixed tools": [
    tool("q1", "question", "completed", { questions: [] }),
    tool("x1", "browser", "completed", {}),
    tool("x2", "custom_tool", "completed", {}),
    tool("x3", "custom_tool", "completed", {}),
    tool("s1", "shell", "completed", { command: "ls" }),
    tool("r1", "read", "completed", { path: "/repo/a.ts" }),
  ],
  thoughts: [thought("t1"), thought("t2")],
  "thoughts and tools": [thought("t1"), tool("r1", "read", "completed", { path: "/repo/a.ts" }), thought("t2")],
  "failed calls": [
    tool("r1", "read", "error", { path: "/repo/missing.ts" }),
    tool("s1", "shell", "error", { command: "false" }),
    tool("e1", "edit", "error", { path: "/repo/a.ts", oldString: "a", newString: "b" }),
  ],
  skills: [
    tool("k1", "skill", "completed", { name: "review" }),
    tool("k2", "skill", "completed", { name: "simplify" }),
  ],
  "v1 tool names": [
    tool("b1", "bash", "completed", { command: "ls" }),
    tool(
      "t1",
      "task",
      "completed",
      { description: "look", subagent_type: "explore" },
      {
        metadata: { sessionID: "ses_1", status: "completed" },
      },
    ),
    tool("p1", "apply_patch", "completed", { patchText: "" }, { metadata: { files: [{ file: "/repo/z.ts" }] } }),
  ],
  "still running": [
    tool("r1", "read", "running", { path: "/repo/a.ts" }),
    tool("s1", "shell", "streaming", { command: "ls" }),
  ],
  empty: [],
} satisfies Record<string, GroupFixturePart[]>
