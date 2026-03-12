import { describe, expect, test } from "bun:test"
import { selectAssistants, sortMessages, splitMessages } from "./message"

describe("message", () => {
  test("sortMessages uses created time before id", () => {
    const result = sortMessages([
      { id: "msg_z", role: "assistant", time: { created: 20 } },
      { id: "msg_a", role: "user", time: { created: 10 } },
    ])

    expect(result.map((item) => item.id)).toEqual(["msg_a", "msg_z"])
  })

  test("selectAssistants finds replies even when assistant id sorts before user id", () => {
    const result = selectAssistants(
      [
        { id: "msg_user", role: "user", time: { created: 10 } },
        { id: "msg_assistant", role: "assistant", parentID: "msg_user", time: { created: 11 } },
      ],
      "msg_user",
    )

    expect(result.map((item) => item.id)).toEqual(["msg_assistant"])
  })

  test("splitMessages uses chronological order instead of id order", () => {
    const result = splitMessages(
      [
        { id: "msg_3", role: "user", time: { created: 30 } },
        { id: "msg_1", role: "user", time: { created: 10 } },
        { id: "msg_2", role: "user", time: { created: 20 } },
      ],
      "msg_2",
    )

    expect(result.before.map((item) => item.id)).toEqual(["msg_1"])
    expect(result.after.map((item) => item.id)).toEqual(["msg_2", "msg_3"])
  })
})
