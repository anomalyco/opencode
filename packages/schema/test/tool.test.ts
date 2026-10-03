import { expect, test } from "bun:test"
import { Tool } from "../src/tool.js"

test("maps V1 tool names to their V2 names", () => {
  expect(["bash", "task", "apply_patch", "plugin_tool"].map(Tool.canonicalName)).toEqual([
    "shell",
    "subagent",
    "patch",
    "plugin_tool",
  ])
})
