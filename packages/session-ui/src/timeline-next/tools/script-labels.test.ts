import { describe, expect, test } from "bun:test"
import type { JsonValue } from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { storyTool } from "../../storybook/current-session-scenarios"
import { factsOf, type FileFact } from "../../timeline/facts"
import { contextGroupLabel } from "../../tools/context-group-label"
import { activityLabel, activityText, usedLabel } from "./activity-label"
import type { ActivityGroupPart } from "./context-group"

// A script counts once as a call; the files it changed count only where they are placed.

const i18n = useI18n()

const script = storyTool(
  "exec_1",
  "execute",
  "completed",
  { code: "x" },
  {
    metadata: {
      toolCalls: [],
      files: [
        { file: "/repo/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-a\n+b\n+c\n" },
        { file: "/repo/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -2 +2,2 @@\n c\n+d\n" },
        { file: "/repo/b.ts", status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+b\n" },
        { file: "/repo/c.bin", status: "deleted", additions: 0, deletions: 9 },
      ],
    },
  },
)

const scriptFiles = factsOf([{ ...script, messageID: "msg_1" }]).filter(
  (fact): fact is FileFact => fact.kind === "file" && fact.via === "script",
)

const files = scriptFiles.map((file) => ({
  type: "file" as const,
  id: file.id,
  file,
  render: () => null,
}))

const next = (parts: ActivityGroupPart[]) => (activityText(activityLabel(parts, i18n)) ?? usedLabel(parts, i18n)).text

describe("script labels", () => {
  test("each change is its own fact, and labels count each path once", () => {
    expect(files.map((part) => part.id)).toEqual([
      "msg_1:exec_1:file:0:/repo/a.ts",
      "msg_1:exec_1:file:1:/repo/a.ts",
      "msg_1:exec_1:file:2:/repo/b.ts",
      "msg_1:exec_1:file:3:/repo/c.bin",
    ])
  })

  test("the current timeline counts a script once, with its files beside it", () => {
    expect(contextGroupLabel([script, ...files], i18n).text).toBe("Used 1 Execute")
  })

  test("a group of a hidden script's files reads as a direct patch's", () => {
    expect(contextGroupLabel(files, i18n).text).toBe("Used 1 Patch")
    expect(next(files)).toBe("Edited 3 files")
  })

  test("a hidden script's changes count as a patch beside the other calls in their group", () => {
    const read = storyTool("read_1", "read", "completed", { path: "/repo/z.ts" })
    const patch = storyTool("patch_2", "patch", "completed", {}, { metadata: { files: [{ file: "/repo/d.ts" }] } })

    expect(contextGroupLabel([read, ...files], i18n).text).toBe("Used 2 Read, Patch")
    expect(contextGroupLabel([...files, patch], i18n).text).toBe("Used 2 Patch")
    expect(next([read, ...files])).toBe("Edited 3 files · 1 read")
    expect(next([...files, patch])).toBe("Edited 4 files")
  })

  test("a script moved to the background, or run as a job, has no changes to show", () => {
    const changed = (metadata: { background?: boolean; jobID?: string }) =>
      factsOf([
        storyTool(
          "exec_2",
          "execute",
          "completed",
          { code: "x" },
          {
            metadata: { toolCalls: [], files: [{ file: "/repo/a.ts", status: "added" }], ...metadata },
          },
        ),
      ]).filter((fact) => fact.kind === "file")

    expect(changed({})).toHaveLength(1)
    expect(changed({ background: true })).toEqual([])
    expect(changed({ jobID: "job_1" })).toEqual([])
  })

  test("the New timeline names scripts by the calls they made", () => {
    const calls = (id: string, toolCalls: JsonValue[], status: "running" | "completed" = "completed") =>
      storyTool(id, "execute", status, { code: "x" }, { metadata: { toolCalls } })

    expect(
      next([
        calls("exec_a", [
          { tool: "read", status: "completed", input: { path: "/repo/a.ts" } },
          { tool: "grep", status: "completed", input: { pattern: "foo" } },
        ]),
        calls("exec_b", [
          { tool: "read", status: "completed", input: { path: "/repo/b.ts" } },
          { tool: "shell", status: "completed", input: { command: "bun test" } },
        ]),
      ]),
    ).toBe("Ran 1 command · 2 reads, 1 search")

    // A script still running counts the calls made so far.
    expect(
      next([calls("exec_c", [{ tool: "read", status: "running", input: { path: "/repo/a.ts" } }], "running")]),
    ).toBe("Explored 1 file")
  })

  test("a loop's repeated calls count once", () => {
    const poll = { tool: "shell", status: "completed", input: { command: "gh pr checks" } }
    const push = { tool: "shell", status: "completed", input: { command: "git push" } }
    const loop = storyTool(
      "exec_loop",
      "execute",
      "completed",
      { code: "x" },
      { metadata: { toolCalls: [poll, poll, push, poll] } },
    )

    expect(next([loop])).toBe("Ran 2 commands")
  })

  test("a script's edits count through the files it changed, not its edit calls", () => {
    const edits = storyTool(
      "exec_edit",
      "execute",
      "completed",
      { code: "x" },
      {
        metadata: {
          toolCalls: [
            { tool: "edit", status: "completed", input: { path: "/repo/a.ts" } },
            { tool: "read", status: "completed", input: { path: "/repo/b.ts" } },
          ],
        },
      },
    )

    expect(next([edits])).toBe("Explored 1 file")

    // One that only edited still counts, where its files are placed elsewhere.
    const editOnly = storyTool(
      "exec_edit_only",
      "execute",
      "completed",
      { code: "x" },
      { metadata: { toolCalls: [{ tool: "edit", status: "completed", input: { path: "/repo/a.ts" } }] } },
    )

    expect(next([editOnly])).toBe("Ran 1 command")
  })

  test("calls to other tools name them by their own name", () => {
    const mcp = storyTool(
      "exec_mcp",
      "execute",
      "completed",
      { code: "x" },
      { metadata: { toolCalls: [{ tool: "anomaly_slack.slack_read_thread", status: "completed", input: {} }] } },
    )

    expect(next([mcp])).toBe("Used slack_read_thread")
  })

  test("a script moved to the background counts the calls it made before it moved", () => {
    const moved = storyTool(
      "exec_bg",
      "execute",
      "completed",
      { code: "x" },
      { metadata: { jobID: "cm_1", toolCalls: [{ tool: "read", status: "running", input: { path: "/repo/a.ts" } }] } },
    )

    expect(next([moved])).toBe("Explored 1 file")
  })

  test("the New timeline counts a script's files only where they are placed", () => {
    expect(next([script, ...files])).toBe("Edited 3 files · 1 command")
    expect(next([script])).toBe("Ran 1 command")
  })
})
