import { describe, expect, test } from "bun:test"
import { queuedMessages } from "../../src/prompt/queued"

const assistant = (id: string, completed?: number) => ({ id, role: "assistant", time: { created: 1, completed } })
const user = (id: string) => ({ id, role: "user", time: { created: 1 } })

describe("prompt queued", () => {
  test("returns user messages sent while a turn is still running", () => {
    expect(
      queuedMessages([user("msg_1"), assistant("msg_2", 2), user("msg_3"), assistant("msg_4"), user("msg_5")]).map(
        (message) => message.id,
      ),
    ).toEqual(["msg_5"])
  })

  test("returns every queued message when several stack up", () => {
    expect(
      queuedMessages([user("msg_1"), assistant("msg_2"), user("msg_3"), user("msg_4")]).map((message) => message.id),
    ).toEqual(["msg_3", "msg_4"])
  })

  test("returns nothing when the session is idle", () => {
    expect(queuedMessages([user("msg_1"), assistant("msg_2", 2)])).toEqual([])
  })

  test("ignores an abandoned turn that a later turn already completed", () => {
    expect(queuedMessages([user("msg_1"), assistant("msg_2"), assistant("msg_3", 3)])).toEqual([])
  })
})
