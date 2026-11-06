import { describe, expect, test } from "bun:test"
import { Message, SystemPart, ToolCallPart } from "@opencode/ai/effect"
import { SessionShellBatch } from "@opencode/core/session/shell-batch"

const calls = (start: number, count: number) => [
  Message.make({
    role: "assistant",
    content: Array.from({ length: count }, (_, index) =>
      ToolCallPart.make({ id: `${start + index}`, name: "shell", input: {} }),
    ),
  }),
  ...Array.from({ length: count }, (_, index) =>
    Message.tool({ id: `${start + index}`, name: "shell", result: "done", resultType: index === 0 ? "error" : "text" }),
  ),
]

describe("shell batching guidance", () => {
  test("adds the Japanese study prompt to the system and first user input without modifying history", () => {
    const original = { system: [SystemPart.make("base")], messages: [Message.user("依頼"), Message.user("追加")] }
    const result = SessionShellBatch.prepare(original, true)
    expect(result.system.at(-1)?.text).toBe(SessionShellBatch.prompt)
    expect(result.messages[0]?.content.at(-1)).toEqual(Message.text(SessionShellBatch.prompt))
    expect(result.messages[1]).toBe(original.messages[1])
    expect(original.messages[0]?.content).toEqual([Message.text("依頼")])
    expect(SessionShellBatch.prepare(original, false)).toBe(original)
  })

  test("adds reminders at complete tool boundaries after every ten shell results", () => {
    const original = { system: [], messages: [Message.user("依頼"), ...calls(0, 9)] }
    expect(
      SessionShellBatch.prepare(original, true).messages.filter((message) => message.role === "system"),
    ).toHaveLength(0)
    const messages = [...original.messages, ...calls(9, 2), ...calls(11, 9)]
    const result = SessionShellBatch.prepare({ system: [], messages }, true).messages
    const reminders = result.flatMap((message, index) => (message.role === "system" ? [index] : []))
    expect(reminders).toHaveLength(2)
    expect(result[reminders[0]! - 1]?.role).toBe("tool")
    expect(result[reminders[0]! - 1]?.content[0]).toMatchObject({ id: "10" })
    expect(result[reminders[1]! - 1]?.content[0]).toMatchObject({ id: "19" })
    expect(result[reminders[0]!]?.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("返答せず") })
  })
})
