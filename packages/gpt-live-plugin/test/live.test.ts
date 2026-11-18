import { describe, expect, test } from "bun:test"

import { claims } from "../src/server/auth"
import { toolLabel } from "../src/server/bridge"
import { background, historyFrom, speakable } from "../src/server/context"
import { chunk, contextAppend, parseCallID, parseEvent } from "../src/server/live"

describe("call id", () => {
  test("reads the rtc id from the Location header", () => {
    expect(parseCallID("/v1/realtime/calls/rtc_u24_ABC-def", null)).toBe("rtc_u24_ABC-def")
  })
  test("falls back to openai-session-id", () => {
    expect(parseCallID(null, "rtc_fallback")).toBe("rtc_fallback")
  })
  test("rejects responses without an id", () => {
    expect(() => parseCallID("/v1/other", "nope")).toThrow()
  })
})

describe("events", () => {
  test("delegation carries the task text", () => {
    const event = parseEvent(
      JSON.stringify({
        type: "delegation.created",
        item: {
          id: "item_1",
          type: "delegation",
          target: "client",
          content: [
            { type: "input_text", text: "How many " },
            { type: "input_text", text: "files?" },
          ],
        },
      }),
    )
    expect(event).toEqual({ kind: "delegation", id: "item_1", text: "How many files?" })
  })
  test("transcripts and turns", () => {
    expect(parseEvent(JSON.stringify({ type: "output_transcript.added", item: { text: " hi" } }))).toEqual({
      kind: "transcript",
      role: "assistant",
      text: " hi",
      final: false,
    })
    expect(parseEvent(JSON.stringify({ type: "turn.done", turn: { role: "user", transcript: "hello" } }))).toEqual({
      kind: "transcript",
      role: "user",
      text: "hello",
      final: true,
    })
  })
  test("auth errors are fatal", () => {
    const event = parseEvent(JSON.stringify({ type: "error", error: { code: "token_expired", message: "expired" } }))
    expect(event).toEqual({ kind: "error", message: "expired", fatal: true })
  })
  test("ignores garbage", () => {
    expect(parseEvent("not json")).toBeUndefined()
    expect(parseEvent(JSON.stringify({ nope: 1 }))).toBeUndefined()
  })
})

describe("context appends", () => {
  test("chunks by UTF-8 bytes without splitting characters", () => {
    const text = "é".repeat(400)
    const parts = chunk(text, 500)
    expect(parts.join("")).toBe(text)
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(500)
  })
  test("delegation vs session context", () => {
    expect(contextAppend("done", "speakable", "item_1")[0]).toEqual({
      type: "delegation.context.append",
      delegation_item_id: "item_1",
      channel: "speakable",
      content: [{ type: "input_text", text: "done" }],
    })
    expect(contextAppend("note", "commentary")[0].type).toBe("session.context.append")
  })
})

describe("instructions", () => {
  test("history is quoted and bounded", () => {
    const history = historyFrom([
      { type: "user", text: "fix the <build>" },
      {
        type: "assistant",
        content: [
          { type: "text", text: "Done." },
          { type: "tool", name: "edit" },
        ],
      },
      { type: "synthetic", text: "ignored" },
    ])
    expect(history).toEqual([
      { role: "user", text: "fix the <build>" },
      { role: "assistant", text: "Done." },
    ])
    const block = background(history)
    expect(block).toContain("<session_history>")
    expect(block).not.toContain("<build>")
  })
  test("speakable strips code", () => {
    expect(speakable("Here:\n```ts\nconst x = 1\n```\nUse `foo`.")).toBe("Here:\n [code omitted] \nUse foo.")
  })
  test("tool labels", () => {
    expect(toolLabel("edit")).toBe("editing code")
    expect(toolLabel("gptlive_main_send")).toBe("handing work to Shuvcode")
    expect(toolLabel("mcp_custom_thing")).toBe("using mcp custom thing")
  })
})

describe("auth claims", () => {
  test("reads account and plan from the access token", () => {
    const payload = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc", chatgpt_plan_type: "pro" } }),
    ).toString("base64url")
    expect(claims(`h.${payload}.s`)).toEqual({ chatgpt_account_id: "acc", chatgpt_plan_type: "pro" })
    expect(claims("garbage")).toEqual({})
  })
})
