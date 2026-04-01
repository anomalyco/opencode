import { describe, expect, test } from "bun:test"
import stripAnsi from "strip-ansi"
import { formatTriggerTable, parseTriggerCreateInput } from "../../src/cli/cmd/trigger"
import { SessionID } from "../../src/session/schema"

describe("trigger cli create parsing", () => {
  test("parses interval command triggers", () => {
    const result = parseTriggerCreateInput({
      interval: 60_000,
      session: "ses_123",
      command: "summarize",
      arguments: "--daily",
    })

    expect(result).toMatchObject({
      interval: 60_000,
      action: {
        type: "command",
        sessionID: SessionID.make("ses_123"),
        command: "summarize",
        arguments: "--daily",
      },
    })
  })

  test("parses one-shot webhook triggers", () => {
    expect(
      parseTriggerCreateInput({
        at: 123,
        webhook: "https://example.test/hook",
        method: "POST",
        body: '{"ok":true}',
        webhookSecret: "secret",
      }),
    ).toEqual({
      schedule: { type: "once", at: 123 },
      action: {
        type: "webhook",
        url: "https://example.test/hook",
        method: "POST",
        body: '{"ok":true}',
      },
      webhook_secret: "secret",
    })
  })

  test("rejects incomplete or conflicting create args", () => {
    expect(parseTriggerCreateInput({})).toBe("Provide either --interval or --at")
    expect(parseTriggerCreateInput({ interval: 1, at: 2 })).toBe("Choose either --interval or --at, not both")
    expect(parseTriggerCreateInput({ interval: 1, session: "ses_123" })).toBe(
      "Command actions require both --session and --command",
    )
    expect(
      parseTriggerCreateInput({ interval: 1, session: "ses_123", command: "x", webhook: "https://example.test" }),
    ).toBe("Choose either a command action (--session + --command) or a webhook action (--webhook)")
  })
})

describe("trigger cli table formatting", () => {
  test("renders trigger rows with schedule action and state", () => {
    const output = stripAnsi(
      formatTriggerTable([
        {
          id: "trg_1",
          schedule: { type: "interval", interval: 60_000 },
          action: { type: "webhook", url: "https://example.test", method: "POST" },
          enabled: true,
          runs: 3,
          last: { source: "manual", status: "success", time: 1 },
          time: { created: 1, next: 2, last: 1 },
        },
      ]),
    )

    expect(output).toContain("ID")
    expect(output).toContain("every 60000ms")
    expect(output).toContain("POST webhook")
    expect(output).toContain("success")
  })
})
