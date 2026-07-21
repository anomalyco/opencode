import { describe, expect, test } from "bun:test"
import {
  createSequentialQueue,
  findRedoUserMessage,
  findUndoUserMessage,
  promptFromMessageParts,
  waitUntil,
} from "../../src/util/session-undo"

describe("util.session-undo", () => {
  const messages = [
    { id: "msg_a", role: "user" },
    { id: "msg_b", role: "assistant" },
    { id: "msg_c", role: "user" },
    { id: "msg_d", role: "assistant" },
    { id: "msg_e", role: "user" },
    { id: "msg_f", role: "assistant" },
  ]

  test("findUndoUserMessage walks earlier on each deepen", () => {
    expect(findUndoUserMessage(messages, undefined)?.id).toBe("msg_e")
    expect(findUndoUserMessage(messages, "msg_e")?.id).toBe("msg_c")
    expect(findUndoUserMessage(messages, "msg_c")?.id).toBe("msg_a")
    expect(findUndoUserMessage(messages, "msg_a")).toBeUndefined()
  })

  test("findRedoUserMessage walks later until unrevert", () => {
    expect(findRedoUserMessage(messages, "msg_a")?.id).toBe("msg_c")
    expect(findRedoUserMessage(messages, "msg_c")?.id).toBe("msg_e")
    expect(findRedoUserMessage(messages, "msg_e")).toBeUndefined()
  })

  test("promptFromMessageParts skips synthetic text and keeps files", () => {
    const file = {
      id: "prt_3",
      messageID: "msg_e",
      sessionID: "ses_1",
      type: "file",
      mime: "image/png",
      filename: "shot.png",
      url: "file:///shot.png",
    }
    const prompt = promptFromMessageParts([
      {
        id: "prt_1",
        messageID: "msg_e",
        sessionID: "ses_1",
        type: "text",
        text: "hello ",
      },
      {
        id: "prt_2",
        messageID: "msg_e",
        sessionID: "ses_1",
        type: "text",
        text: "vision describe",
        synthetic: true,
      },
      file,
      {
        id: "prt_4",
        messageID: "msg_e",
        sessionID: "ses_1",
        type: "text",
        text: "world",
      },
    ])
    expect(prompt.input).toBe("hello world")
    expect(prompt.parts).toHaveLength(1)
    expect(prompt.parts[0]).toMatchObject({ type: "file", filename: "shot.png" })
    expect(prompt.parts[0]).not.toHaveProperty("id")
  })

  test("createSequentialQueue runs tasks one at a time", async () => {
    const queue = createSequentialQueue()
    const order: number[] = []
    const first = queue.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      order.push(1)
    })
    const second = queue.enqueue(async () => {
      order.push(2)
    })
    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
  })

  test("waitUntil resolves when predicate becomes true", async () => {
    let ready = false
    setTimeout(() => {
      ready = true
    }, 20)
    expect(await waitUntil(() => ready, { timeoutMs: 500, intervalMs: 10 })).toBe(true)
  })

  test("waitUntil times out when predicate never becomes true", async () => {
    expect(await waitUntil(() => false, { timeoutMs: 40, intervalMs: 10 })).toBe(false)
  })
})
