import { describe, expect, test } from "bun:test"
import { AutomationTransfer } from "@opencode-ai/util/automation-transfer"

describe("automation.transfer", () => {
  test("serializes automation exports with version", () => {
    const result = AutomationTransfer.serialize([
      {
        name: "Daily Review",
        projects: ["/repo/a"],
        prompt: "Summarize changes",
        schedule: "0 9 * * 1-5",
        enabled: true,
      },
    ])

    expect(result.version).toBe(1)
    expect(result.automations).toHaveLength(1)
    expect(result.automations[0]?.name).toBe("Daily Review")
  })

  test("parses valid payload and normalizes projects", () => {
    const result = AutomationTransfer.parse({
      automations: [
        {
          name: "Nightly",
          projects: [" /repo/a ", "/repo/a", "", " /repo/b"],
          prompt: "Run checks",
          schedule: null,
          enabled: false,
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.projects).toEqual(["/repo/a", "/repo/b"])
  })

  test("accepts array payload shorthand", () => {
    const result = AutomationTransfer.parse([
      {
        name: "Morning",
        projects: ["/repo/a"],
        prompt: "Ping",
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("Morning")
  })

  test("returns empty list for invalid payload", () => {
    expect(AutomationTransfer.parse({ automations: [{ name: "x" }] })).toEqual([])
    expect(AutomationTransfer.parse(null)).toEqual([])
  })
})
