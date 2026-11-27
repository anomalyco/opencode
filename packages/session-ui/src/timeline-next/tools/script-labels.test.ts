import type { JsonValue } from "@opencode/client/promise"
import { describe, expect, test } from "bun:test"
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

  test("the New timeline counts a script's files only where they are placed", () => {
    expect(next([script, ...files])).toBe("Edited 3 files · 1 command")
    expect(next([script])).toBe("Ran 1 command")
  })

  describe("counting a script's steps", () => {
    const step = (tool: string, input: Record<string, string>, status = "completed") => ({ tool, status, input })

    const changes = script.state.status === "completed" ? (script.state.metadata?.files ?? []) : []

    const stepped = (toolCalls: JsonValue[], status: "running" | "completed" = "completed") =>
      storyTool("exec_1", "execute", status, { code: "x" }, { metadata: { files: changes, toolCalls } })

    const steps = stepped([
      step("read", { path: "/repo/a.ts" }),
      step("shell", { command: "ls" }),
      step("edit", { path: "/repo/a.ts" }),
      step("write", { path: "/repo/b.ts" }),
      step("patch", { patchText: "x" }),
      step("Bun", { method: "write", path: "/repo/c.bin" }),
    ])

    const stepsNext = (parts: ActivityGroupPart[]) =>
      (activityText(activityLabel(parts, i18n, true)) ?? usedLabel(parts, i18n)).text

    test("Compact: a script beside its files counts its steps, with no patch", () => {
      expect(contextGroupLabel([steps, ...files], i18n, true).text).toBe("Used 6 Read, Shell, Edit, Write, Patch")
      expect(stepsNext([steps, ...files])).toBe("Edited 3 files · 1 command, 1 read")
    })

    test("Quiet: a hidden script's files still read as a patch", () => {
      expect(contextGroupLabel(files, i18n, true).text).toBe("Used 1 Patch")
      expect(stepsNext(files)).toBe("Edited 3 files")
    })

    test("a script with no steps to count counts as itself", () => {
      expect(contextGroupLabel([stepped([], "running")], i18n, true).text).toBe("Used 1 Execute")
      expect(contextGroupLabel([stepped([step("Bun", { method: "spawn" })])], i18n, true).text).toBe("Used 1 Execute")
    })

    test("live Bun steps count as recorded, and old Bun writes as edits", () => {
      const live = storyTool(
        "exec_3",
        "execute",
        "completed",
        { code: "x" },
        {
          metadata: {
            toolCalls: [
              step("read", { path: "/repo/a.ts" }),
              step("write", { path: "/repo/b.ts" }),
              step("glob", { pattern: "src/**/*.ts" }),
            ],
            files: [{ file: "/repo/b.ts", status: "added", additions: 1, deletions: 0 }],
          },
        },
      )

      const liveFiles = factsOf([live]).flatMap((fact) =>
        fact.kind === "file" && fact.via === "script"
          ? [{ type: "file" as const, id: fact.id, file: fact, render: () => null }]
          : [],
      )

      expect(contextGroupLabel([live, ...liveFiles], i18n, true).text).toBe("Used 3 Read, Write, Glob")
      expect(stepsNext([live, ...liveFiles])).toBe("Edited b.ts · 1 read, 1 search")
      expect(
        contextGroupLabel([stepped([step("Bun", { method: "write", path: "/repo/b.ts" })])], i18n, true).text,
      ).toBe("Used 1 Edit")
    })

    test("an edit step before its files land does not name the group as edits", () => {
      const running = storyTool(
        "exec_2",
        "execute",
        "running",
        { code: "x" },
        {
          metadata: {
            files: [],
            toolCalls: [step("read", { path: "/repo/a.ts" }), step("edit", { path: "/repo/a.ts" }, "running")],
          },
        },
      )

      expect(stepsNext([running])).not.toContain("Edited")
    })
  })
})
