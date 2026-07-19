import { describe, expect, test } from "bun:test"
import { toolInlineInfo, toolOutputText, toolView } from "../../src/mini/tool"

describe("Mini tool presentation", () => {
  test("renders the renamed shell tool with the shell rule", () => {
    const part = {
      id: "part-shell",
      sessionID: "session-shell",
      messageID: "message-shell",
      callID: "call-shell",
      tool: "shell",
      state: {
        status: "pending" as const,
        input: { command: "pwd" },
      },
    } as const

    expect(toolView(part.tool)).toEqual({ output: true, final: false })
    expect(toolInlineInfo(part)).toMatchObject({ icon: "$", title: "pwd", mode: "block" })
  })

  test("uses non-empty V2 shell output without the model-facing status", () => {
    expect(
      toolOutputText("shell", [
        { type: "text", text: "mini-output\n" },
        { type: "text", text: "Command exited with code 0." },
      ]),
    ).toBe("mini-output\n")
  })

  test("keeps empty V2 shell output empty", () => {
    expect(
      toolOutputText("shell", [
        { type: "text", text: "" },
        { type: "text", text: "Command exited with code 0." },
      ]),
    ).toBe("")
  })
})
