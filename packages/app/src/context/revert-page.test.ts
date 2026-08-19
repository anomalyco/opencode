import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { boundaryFromMessageResponse } from "@opencode-ai/core/util/revert-boundary"
import { hasVisibleUserBeforeRevert, loadRevertAwareLatestPage } from "./revert-page"

const message = (id: string, role: Message["role"]): Message =>
  role === "assistant"
    ? ({
        id,
        sessionID: "ses_1",
        role: "assistant",
        agent: "default",
        model: { providerID: "openai", modelID: "gpt-4" },
        time: { created: Number(id.slice(2)) },
      } as unknown as Message)
    : ({
        id,
        sessionID: "ses_1",
        role: "user",
        agent: "default",
        model: { providerID: "openai", modelID: "gpt-4" },
        time: { created: Number(id.slice(2)) },
      } as unknown as Message)

const textPart = (id: string, messageID: string): Extract<Part, { type: "text" }> => ({
  id,
  sessionID: "ses_1",
  messageID,
  type: "text",
  text: id,
})

describe("revert page helpers", () => {
  test("only treats 404 boundary fetch responses as missing boundaries", () => {
    const found = { info: message("m6", "user"), parts: [textPart("p6", "m6")], cursor: "boundary" }
    expect(boundaryFromMessageResponse({ data: found, error: undefined, response: { status: 200 } })).toBe(found)
    expect(
      boundaryFromMessageResponse({ data: undefined, error: { message: "missing" }, response: { status: 404 } }),
    ).toBeUndefined()
    expect(() =>
      boundaryFromMessageResponse({ data: undefined, error: new Error("server failed"), response: { status: 500 } }),
    ).toThrow("server failed")
    expect(() => boundaryFromMessageResponse({ data: undefined, error: new Error("network failed") })).toThrow(
      "network failed",
    )
    expect(() => boundaryFromMessageResponse({ data: undefined, error: undefined, response: { status: 200 } })).toThrow(
      "missing revert boundary message",
    )
  })

  test("detects when the loaded page has no visible user before revert", () => {
    expect(hasVisibleUserBeforeRevert([message("m6", "user"), message("m7", "assistant")], { messageID: "m6" })).toBe(
      false,
    )
    expect(
      hasVisibleUserBeforeRevert(
        [message("m5", "user"), message("m6", "user")],
        { messageID: "m6" },
        message("m6", "user"),
      ),
    ).toBe(true)
  })

  test("treats a user boundary as visible for part-level reverts", () => {
    const messages = [message("m6", "user"), message("m7", "assistant")]
    expect(hasVisibleUserBeforeRevert(messages, { messageID: "m6", partID: "p6" })).toBe(true)
    expect(hasVisibleUserBeforeRevert(messages, { messageID: "m6" })).toBe(false)
  })

  test("does not walk older history for a part-level revert at the first user", async () => {
    const boundaryPart = textPart("p6", "m6")
    let olderCalls = 0

    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m6", "user"), message("m7", "assistant")],
        part: [
          { id: "m6", part: [boundaryPart] },
          { id: "m7", part: [] },
        ],
        cursor: undefined,
        complete: true,
      },
      revert: { messageID: "m6", partID: "p6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [boundaryPart], cursor: "boundary" }),
      fetchPage: async () => {
        olderCalls += 1
        return { session: [], part: [], cursor: undefined, complete: true }
      },
    })

    expect(olderCalls).toBe(0)
    expect(result.session.map((item) => item.id)).toEqual(["m6", "m7"])
  })

  test("loads and merges an older boundary window when latest page is fully reverted", async () => {
    const olderPart = textPart("p5", "m5")
    const boundaryPart = textPart("p6", "m6")

    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m6", "user"), message("m7", "assistant"), message("m8", "user")],
        part: [
          { id: "m6", part: [boundaryPart] },
          { id: "m7", part: [] },
          { id: "m8", part: [] },
        ],
        cursor: undefined,
        complete: true,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [boundaryPart], cursor: "boundary" }),
      fetchPage: async (before) => {
        expect(before).toBe("boundary")
        return {
          session: [message("m4", "assistant"), message("m5", "user")],
          part: [
            { id: "m4", part: [] },
            { id: "m5", part: [olderPart] },
          ],
          cursor: "older",
          complete: false,
        }
      },
    })

    expect(result.session.map((item) => item.id)).toEqual(["m4", "m5", "m6", "m7", "m8"])
    expect(result.part.find((item) => item.id === "m5")?.part).toEqual([olderPart])
    expect(result.part.find((item) => item.id === "m6")?.part).toEqual([boundaryPart])
    expect(result.cursor).toBe("older")
    expect(result.complete).toBe(false)
  })

  test("merges the fetched boundary when the current page already has a visible prior user", async () => {
    const boundaryPart = textPart("p6", "m6")
    let olderCalls = 0

    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m5", "user"), message("m7", "assistant")],
        part: [
          { id: "m5", part: [] },
          { id: "m7", part: [] },
        ],
        cursor: undefined,
        complete: true,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [boundaryPart], cursor: "boundary" }),
      fetchPage: async () => {
        olderCalls += 1
        return { session: [], part: [], cursor: undefined, complete: true }
      },
    })

    expect(olderCalls).toBe(0)
    expect(result.session.map((item) => item.id)).toEqual(["m5", "m6", "m7"])
    expect(result.part.find((item) => item.id === "m6")?.part).toEqual([boundaryPart])
  })

  test("merges the fetched boundary when no older boundary cursor exists", async () => {
    const boundaryPart = textPart("p6", "m6")

    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m7", "assistant")],
        part: [{ id: "m7", part: [] }],
        cursor: undefined,
        complete: true,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [boundaryPart] }),
      fetchPage: async () => ({ session: [], part: [], cursor: undefined, complete: true }),
    })

    expect(result.session.map((item) => item.id)).toEqual(["m6", "m7"])
    expect(result.part.find((item) => item.id === "m6")?.part).toEqual([boundaryPart])
  })

  test("walks the latest cursor when an older server omits the boundary cursor", async () => {
    let before: string | undefined
    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m7", "assistant")],
        part: [{ id: "m7", part: [] }],
        cursor: "raw-hidden-older",
        complete: false,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [] }),
      fetchPage: async (cursor) => {
        before = cursor
        return { session: [message("m5", "user")], part: [], cursor: undefined, complete: true }
      },
    })

    expect(before).toBe("raw-hidden-older")
    expect(result.session.map((item) => item.id)).toEqual(["m5", "m6", "m7"])
    expect(result.cursor).toBeUndefined()
    expect(result.complete).toBe(true)
  })

  test("keeps loading older pages until a visible user exists before revert", async () => {
    const boundaryPart = textPart("p6", "m6")
    const olderPart = textPart("p3", "m3")
    let call = 0

    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m6", "user"), message("m7", "assistant"), message("m8", "user")],
        part: [
          { id: "m6", part: [boundaryPart] },
          { id: "m7", part: [] },
          { id: "m8", part: [] },
        ],
        cursor: undefined,
        complete: true,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [boundaryPart], cursor: "boundary" }),
      fetchPage: async () => {
        call += 1
        if (call === 1) {
          return {
            session: [message("m4", "assistant"), message("m5", "assistant")],
            part: [
              { id: "m4", part: [] },
              { id: "m5", part: [] },
            ],
            cursor: "older-2",
            complete: false,
          }
        }
        return {
          session: [message("m3", "user")],
          part: [{ id: "m3", part: [olderPart] }],
          cursor: undefined,
          complete: true,
        }
      },
    })

    expect(call).toBe(2)
    expect(result.session.map((item) => item.id)).toEqual(["m3", "m4", "m5", "m6", "m7", "m8"])
    expect(result.part.find((item) => item.id === "m3")?.part).toEqual([olderPart])
    expect(result.cursor).toBeUndefined()
    expect(result.complete).toBe(true)
  })

  test("rejects a repeated older page instead of looping", async () => {
    let calls = 0
    const current = {
      session: [message("m6", "user"), message("m7", "assistant")],
      part: [],
      cursor: "repeat",
      complete: false,
    }

    await expect(
      loadRevertAwareLatestPage({
        current,
        revert: { messageID: "m6" },
        fetchMessage: async () => ({ info: message("m6", "user"), parts: [], cursor: "repeat" }),
        fetchPage: async () => {
          calls += 1
          if (calls > 1) throw new Error("pagination did not stop")
          return current
        },
      }),
    ).rejects.toThrow("Message pagination returned no new messages")
    expect(calls).toBe(1)
  })

  test("keeps an unseen page that completes revert repair even when its cursor repeats", async () => {
    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m6", "user"), message("m7", "assistant")],
        part: [],
        cursor: "repeat",
        complete: false,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => ({ info: message("m6", "user"), parts: [], cursor: "repeat" }),
      fetchPage: async () => ({
        session: [message("m5", "user")],
        part: [],
        cursor: "repeat",
        complete: false,
      }),
    })

    expect(result.session.map((message) => message.id)).toEqual(["m5", "m6", "m7"])
  })

  test("marks stale revert boundaries for clearing when the boundary message is missing", async () => {
    const result = await loadRevertAwareLatestPage({
      current: {
        session: [message("m7", "assistant"), message("m8", "user")],
        part: [
          { id: "m7", part: [] },
          { id: "m8", part: [] },
        ],
        cursor: undefined,
        complete: true,
      },
      revert: { messageID: "m6" },
      fetchMessage: async () => undefined,
      fetchPage: async () => ({
        session: [],
        part: [],
        cursor: undefined,
        complete: true,
      }),
    })

    expect(result.clearedRevert).toBe(true)
    expect(result.session.map((item) => item.id)).toEqual(["m7", "m8"])
  })
})
