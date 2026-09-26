import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { renderSummary, Parameters } from "../src/tool/task-parallel"

describe("task-parallel renderSummary", () => {
  test("renders completed and error outcomes with state labels", () => {
    const output = renderSummary([
      { description: "Write tests", state: "completed", text: "All tests pass" },
      { description: "Refactor module", state: "error", text: "File not found" },
    ])
    expect(output).toContain("<parallel-tasks>")
    expect(output).toContain("- Write tests: COMPLETED")
    expect(output).toContain("  All tests pass")
    expect(output).toContain("- Refactor module: ERROR")
    expect(output).toContain("  File not found")
    expect(output).toContain("</parallel-tasks>")
  })

  test("renders empty result list", () => {
    expect(renderSummary([])).toBe("<parallel-tasks>\n</parallel-tasks>")
  })

  test("indents multi-line subtask text", () => {
    const output = renderSummary([{ description: "Docs", state: "completed", text: "line1\nline2" }])
    expect(output).toContain("  line1\n  line2")
  })
})

describe("task-parallel Parameters schema", () => {
  test("accepts a list of valid subtasks", () => {
    const result = Schema.decodeUnknownSync(Parameters)({
      tasks: [
        { description: "a", prompt: "do a", subagent_type: "general" },
        { description: "b", prompt: "do b", subagent_type: "general" },
      ],
    })
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0].subagent_type).toBe("general")
  })

  test("rejects a non-array tasks field", () => {
    expect(() => Schema.decodeUnknownSync(Parameters)({ tasks: "not-an-array" })).toThrow()
  })

  test("rejects a subtask missing required fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(Parameters)({ tasks: [{ description: "only description" }] }),
    ).toThrow()
  })
})
