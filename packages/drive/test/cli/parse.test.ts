import { describe, expect, test } from "vitest"
import { extractCommands } from "../../src/cli/parse.js"

describe("drive CLI parser", () => {
  test("preserves namespaced command order", () => {
    expect(
      extractCommands([
        "send",
        "--command.ui.type",
        '{"text":"hello"}',
        "--command.ui.screenshot",
        '{"name":"home"}',
        "--command.ui.screenshot",
        "--command.ui.matches",
        '{"text":"hello"}',
        "--command.ui.state",
      ]),
    ).toEqual({
      args: ["send"],
      app: [],
      commands: [
        { operation: "ui.type", value: '{"text":"hello"}' },
        { operation: "ui.screenshot", value: '{"name":"home"}' },
        { operation: "ui.screenshot" },
        { operation: "ui.matches", value: '{"text":"hello"}' },
        { operation: "ui.state" },
      ],
    })
  })

  test("keeps the custom OpenCode argv intact", () => {
    expect(extractCommands(["start", "--", "bun", "app.ts", "--standalone", "--help"])).toEqual({
      args: ["start"],
      app: ["bun", "app.ts", "--standalone", "--help"],
      commands: [],
    })
  })

  test("rejects unknown namespaced commands", () => {
    expect(() => extractCommands(["send", "--command.unknown"])).toThrow("unknown drive command")
  })

  test("rejects LLM commands", () => {
    expect(() => extractCommands(["send", "--command.llm.pending"])).toThrow("unknown drive command")
  })
})
