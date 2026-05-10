import { describe, expect, test } from "bun:test"
import { AutomationTesting } from "../../src/automation/automation"
import type { MessageV2 } from "../../src/session/message-v2"

const reportJson = JSON.stringify({
  result: "findings",
  summary: "Updated the automation report pipeline.",
  findings: [
    {
      title: "Markdown reports render cleanly",
      severity: "medium",
      details: "The report is stored as Markdown without raw JSON.",
      filesChanged: ["packages/opencode/src/automation/automation.ts"],
    },
  ],
})

const message = (text: string) =>
  ({
    info: { role: "assistant" },
    parts: [{ type: "text", text }],
  }) as MessageV2.WithParts

describe("automation output", () => {
  test("parses structured report JSON from fenced Markdown", () => {
    const output = AutomationTesting.parseTextOutput(["Done.", "", "```json", reportJson, "```"].join("\n"))

    expect(output?.summary).toBe("Updated the automation report pipeline.")
    expect(output?.findings[0]?.details).toBe("The report is stored as Markdown without raw JSON.")
  })

  test("parses optional automation_result blocks without requiring structured output", () => {
    const output = AutomationTesting.parseTextOutput(["Done.", "", "```automation_result", reportJson, "```"].join("\n"))

    expect(output?.result).toBe("findings")
    expect(output?.findings[0]?.title).toBe("Markdown reports render cleanly")
  })

  test("strips structured JSON when cleaning fallback report text", () => {
    expect(
      AutomationTesting.cleanReportText(["Before", "```automation_result", reportJson, "```", "After"].join("\n")),
    ).toBe("Before\n\nAfter")
  })

  test("uses parsed structured output instead of duplicating raw JSON in fallback reports", () => {
    const output = AutomationTesting.fallbackOutput(message(["```json", reportJson, "```"].join("\n")))

    expect(output.summary).toBe("Updated the automation report pipeline.")
    expect(output.findings).toHaveLength(1)
    expect(output.findings[0]?.details).not.toContain("{")
  })
})
