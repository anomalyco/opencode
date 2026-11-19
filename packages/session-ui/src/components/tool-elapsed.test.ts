import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { anchorElapsedStart } from "./tool-elapsed"

// SAFETY: the fixture sets every field a user message reads, so it is a complete SessionMessageInfo.
const user = (id: string, created: number): SessionMessageInfo =>
  ({ id, type: "user", text: "hello", time: { created } }) as SessionMessageInfo

describe("anchorElapsedStart", () => {
  test("counts from the content's own start with no newer prompt", () => {
    expect(anchorElapsedStart(1000, [user("msg_1", 1000)])).toBe(1000)
  })

  test("moves forward to a follow-up sent while the previous turn still streams", () => {
    const messages = [user("msg_1", 1000), user("msg_2", 97000)]

    expect(anchorElapsedStart(2000, messages)).toBe(97000)
  })

  test("ignores non-user messages and older prompts", () => {
    const messages: SessionMessageInfo[] = [
      user("msg_1", 1000),
      // SAFETY: only type and time are read, which this non-user fixture supplies.
      {
        id: "msg_2",
        type: "synthetic",
        text: "note",
        time: { created: 200000 },
      } as SessionMessageInfo,
    ]

    expect(anchorElapsedStart(5000, messages)).toBe(5000)
  })

  test("keeps the content start when nothing is newer", () => {
    expect(anchorElapsedStart(5000, [])).toBe(5000)
  })
})
