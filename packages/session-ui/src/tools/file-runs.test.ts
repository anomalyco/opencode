import { describe, expect, test } from "bun:test"
import { storyTool } from "../storybook/current-session-scenarios"
import type { FileFact } from "../timeline/facts"
import { fileRuns } from "./file-runs"

const change = (index: number, path: string): FileFact => ({
  kind: "file",
  id: `msg_1:exec_1:file:${index}:${path}`,
  path,
  status: "completed",
  change: "modified",
  by: "msg_1:exec_1",
  via: "script",
})

describe("file runs", () => {
  test("direct changes and a script's changes stay in the order they happened", () => {
    const edit = storyTool("edit_a", "edit", "completed", { path: "/repo/a.ts" })
    const patch = storyTool("patch_c", "patch", "completed", {})
    const runs = fileRuns([edit, change(0, "/repo/b.ts"), change(1, "/repo/b2.ts"), patch])

    expect(
      runs.map((run) => (run.type === "tools" ? run.tools.map((tool) => tool.id) : run.files.map((file) => file.path))),
    ).toEqual([["edit_a"], ["/repo/b.ts", "/repo/b2.ts"], ["patch_c"]])
  })

  test("calls one after another stay one run", () => {
    const runs = fileRuns([
      storyTool("edit_a", "edit", "completed", { path: "/repo/a.ts" }),
      storyTool("write_b", "write", "completed", { path: "/repo/b.ts", content: "b" }),
    ])

    expect(runs).toHaveLength(1)
    expect(runs[0]?.type).toBe("tools")
  })
})
