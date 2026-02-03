import { describe, expect, test } from "bun:test"
import { Truncate } from "../../src/tool/truncation"
import { formatTaskOutput } from "../../src/tool/task"

describe("tool.task truncation", () => {
  test("keeps task_metadata after truncation", async () => {
    const text = Array.from({ length: Truncate.MAX_LINES + 5 }, (_, i) => `line ${i}`).join("\n")
    const result = await formatTaskOutput(text, "ses_test")

    expect(result.metadata.truncated).toBe(true)
    expect(result.output).toContain("<task_metadata>")
    expect(result.output).toContain("session_id: ses_test")
  })
})
