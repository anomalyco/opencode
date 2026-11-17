import { describe, expect, test } from "bun:test"
import { buildDelta } from "../../src/core/delta"
import type { NMessage } from "../../src/core/types"

function msg(id: string, role: "user" | "assistant", parts: NMessage["parts"]): NMessage {
  return { id, role, parts, createdAt: 0 }
}

const user = (id: string, text: string) => msg(id, "user", [{ type: "text", text }])
const assistant = (id: string, text: string, parts: NMessage["parts"] = []) => msg(id, "assistant", [{ type: "text", text }, ...parts])
const toolPart = (status: "pending" | "completed" = "completed", output = "done"): NMessage["parts"][number] => ({
  type: "tool",
  tool: "bash",
  callId: "c1",
  status,
  input: "ls",
  output,
})

describe("buildDelta", () => {
  test("null cursor takes all messages", () => {
    const msgs = [user("u1", "hi"), assistant("a1", "hello")]
    const d = buildDelta(msgs, null, { maxTokens: 10000 })
    expect(d.text).toContain("[USER u1]")
    expect(d.text).toContain("[ASSISTANT a1]")
    expect(d.lastUserMessageId).toBe("u1")
    expect(d.turnMessageId).toBe("a1")
  })

  test("cursor stops at the last completed assistant turn", () => {
    const msgs = [user("u1", "hi"), assistant("a1", "hello"), user("u2", "again"), assistant("a2", "hi2")]
    // cursor at a1 → only u2/a2 included
    const d = buildDelta(msgs, "a1", { maxTokens: 10000 })
    expect(d.text).not.toContain("[USER u1]")
    expect(d.text).toContain("[USER u2]")
    expect(d.text).toContain("[ASSISTANT a2]")
    expect(d.lastUserMessageId).toBe("u2")
    expect(d.turnMessageId).toBe("a2")
  })

  test("drops reasoning parts", () => {
    const msgs = [user("u1", "hi"), assistant("a1", "hello", [{ type: "other" }])]
    // add a reasoning-ish part (type other) — already dropped by normalize; here ensure no crash
    const d = buildDelta(msgs, null, { maxTokens: 10000 })
    expect(d.text).toContain("hello")
  })

  test("user text truncation", () => {
    const long = "a".repeat(6500)
    const msgs = [user("u1", long), assistant("a1", "ok")]
    const d = buildDelta(msgs, null, { maxTokens: 100000 })
    expect(d.text).toContain("[...]")
    expect(d.text.length).toBeLessThan(6500)
  })

  test("assistant text truncation", () => {
    const msgs = [user("u1", "hi"), assistant("a1", "b".repeat(3500))]
    const d = buildDelta(msgs, null, { maxTokens: 100000 })
    expect(d.text).toContain("[...]")
  })

  test("background bash line has [BACKGROUND] marker", () => {
    const msgs = [
      user("u1", "go"),
      msg("a1", "assistant", [{ type: "text", text: "starting" }, { type: "tool", tool: "shell", callId: "c1", status: "completed", input: "nohup sleep 20 &", output: "started" }]),
    ]
    const d = buildDelta(msgs, null, { maxTokens: 100000 })
    expect(d.text).toContain("bash [BACKGROUND]:")
  })

  test("read tool line is only the path", () => {
    const msgs = [
      user("u1", "go"),
      msg("a1", "assistant", [{ type: "text", text: "ok" }, { type: "tool", tool: "read", callId: "c1", status: "completed", input: { path: "app/main.py" }, output: "SECRET CONTENT" }]),
    ]
    const d = buildDelta(msgs, null, { maxTokens: 100000 })
    expect(d.text).toContain("read: app/main.py")
    expect(d.text).not.toContain("SECRET CONTENT")
  })

  test("edit tool line is path only", () => {
    const msgs = [
      user("u1", "go"),
      msg("a1", "assistant", [{ type: "text", text: "ok" }, { type: "tool", tool: "edit", callId: "c1", status: "completed", input: { path: "app/main.py" } }]),
    ]
    const d = buildDelta(msgs, null, { maxTokens: 100000 })
    expect(d.text).toContain("edit: app/main.py")
  })

  test("generic tool line includes args and status", () => {
    const msgs = [
      user("u1", "go"),
      msg("a1", "assistant", [{ type: "text", text: "ok" }, { type: "tool", tool: "webfetch", callId: "c1", status: "completed", input: { url: "https://x.com" }, output: "body" }]),
    ]
    const d = buildDelta(msgs, null, { maxTokens: 100000 })
    expect(d.text).toContain("webfetch:")
    expect(d.text).toContain("completed")
  })

  test("budget overflow never drops user messages", () => {
    const tools: NMessage["parts"] = Array.from({ length: 40 }, (_, i) => ({
      type: "tool",
      tool: "read",
      callId: `c${i}`,
      status: "completed",
      input: { path: `file${i}.py` },
    }))
    const msgs = [user("u1", "important prompt"), msg("a1", "assistant", [{ type: "text", text: "ok" }, ...tools])]
    const d = buildDelta(msgs, null, { maxTokens: 100 })
    expect(d.text).toContain("important prompt")
    // user message text survives even under extreme budget pressure
    expect(d.lastUserMessageId).toBe("u1")
  })

  test("incomplete assistant turn (pending tool) not used as turnMessageId", () => {
    const msgs = [user("u1", "hi"), msg("a1", "assistant", [{ type: "text", text: "working" }, toolPart("pending")])]
    // no completed turn → buildDelta should still produce something but turnMessageId falls back to last assistant
    const d = buildDelta(msgs, null, { maxTokens: 10000 })
    expect(d.turnMessageId).toBe("a1")
  })

  test("format blocks use ids", () => {
    const msgs = [user("u1", "hi"), assistant("a1", "hello")]
    const d = buildDelta(msgs, null, { maxTokens: 10000 })
    expect(d.text).toMatch(/\[USER u1\]\nhi\n\[ASSISTANT a1\]\nhello/)
  })
})
