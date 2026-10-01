import { describe, expect, test } from "bun:test"
import { createQuickUndo } from "./quick-undo"

const noParts = () => []

describe("quick undo", () => {
  test("offers the submitted prompt before any reply exists", () => {
    const undo = createQuickUndo<string>()
    undo.submitted({ sessionID: "ses_1", messageID: "msg_1", value: "hello" })

    expect(undo.candidate("ses_1", [{ id: "msg_1", role: "user" }], noParts)?.value).toBe("hello")
  })

  test("ignores other sessions", () => {
    const undo = createQuickUndo<string>()
    undo.submitted({ sessionID: "ses_1", messageID: "msg_1", value: "hello" })

    expect(undo.candidate("ses_2", [], noParts)).toBeUndefined()
  })

  test("still offers undo while the reply only has reasoning or empty text", () => {
    const undo = createQuickUndo<string>()
    undo.submitted({ sessionID: "ses_1", messageID: "msg_1", value: "hello" })
    const messages = [
      { id: "msg_1", role: "user" },
      { id: "msg_2", role: "assistant", parentID: "msg_1" },
    ]
    const parts = () => [{ type: "step-start" }, { type: "reasoning", text: "thinking" }, { type: "text", text: " " }]

    expect(undo.candidate("ses_1", messages, parts)?.messageID).toBe("msg_1")
  })

  test("stops offering undo once the reply shows text or a tool call", () => {
    const undo = createQuickUndo<string>()
    undo.submitted({ sessionID: "ses_1", messageID: "msg_1", value: "hello" })
    const messages = [
      { id: "msg_1", role: "user" },
      { id: "msg_2", role: "assistant", parentID: "msg_1" },
    ]

    expect(undo.candidate("ses_1", messages, () => [{ type: "text", text: "Sure" }])).toBeUndefined()
    expect(undo.candidate("ses_1", messages, () => [{ type: "tool" }])).toBeUndefined()
  })

  test("clear drops the candidate", () => {
    const undo = createQuickUndo<string>()
    undo.submitted({ sessionID: "ses_1", messageID: "msg_1", value: "hello" })
    undo.clear()

    expect(undo.candidate("ses_1", [], noParts)).toBeUndefined()
  })
})
