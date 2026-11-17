import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { normalizeMessage, normalizeProjectedMessages, messageId, hasRolloverContext, isSyntheticWake } from "../../src/adapter/opencode/normalize"
import type { NMessage } from "../../src/core/types"

const fixture = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "../fixtures/p0", name), "utf8"))

describe("normalizeMessage", () => {
  test("user message with text parts", () => {
    const fx = fixture("context-1.json")
    const m = fx.messages[0]
    const n = normalizeMessage(m)
    expect(n.role).toBe("user")
    expect(n.id).toBe(m.id)
    expect(n.parts[0]).toEqual({ type: "text", text: m.content[0].text })
  })

  test("rollover command reply is synthetic via metadata marker", () => {
    const fx = fixture("context-1.json")
    const n = normalizeMessage({ ...fx.messages[0], metadata: { source: "rollover" } })
    expect(n.synthetic).toBe(true)
  })

  test("unrelated metadata keeps a real user message real", () => {
    const fx = fixture("context-1.json")
    const n = normalizeMessage({ ...fx.messages[0], metadata: { source: "prompt" } })
    expect(n.synthetic).toBeUndefined()
  })

  test("assistant tool-call + tool-result fixture", () => {
    const fx = fixture("context-2.json")
    const assistantMsg = fx.messages[1]
    const toolMsg = fx.messages[2]
    const na = normalizeMessage(assistantMsg)
    const nt = normalizeMessage(toolMsg)
    expect(na.role).toBe("assistant")
    expect(na.parts.some((p) => p.type === "tool" && p.tool === "read" && p.callId === "call_read_1")).toBe(true)
    // tool-role message becomes an assistant message carrying completed tool parts
    expect(nt.role).toBe("assistant")
    expect(nt.parts.some((p) => p.type === "tool" && p.status === "completed" && p.callId === "call_read_1")).toBe(true)
    const toolPart = nt.parts.find((p) => p.type === "tool")!
    expect(toolPart.output).toContain("alpha line")
  })

  test("fingerprint stable across rebuilt arrays", () => {
    const fx = fixture("context-1.json")
    const m = fx.messages[0]
    const id1 = messageId(m, 0)
    const id2 = messageId({ ...m }, 0)
    expect(id1).toBe(id2)
    expect(id1).toBe(m.id)
  })

  test("fingerprint differs when content differs", () => {
    const fx = fixture("context-1.json")
    const m = { ...fx.messages[0] }
    delete (m as { id?: string }).id
    const m2 = { ...m, content: [{ type: "text", text: "different" }] }
    expect(messageId(m2, 0)).not.toBe(messageId(m, 0))
  })

  test("fingerprint for missing id", () => {
    const fx = fixture("context-1.json")
    const m = { ...fx.messages[0] }
    delete (m as { id?: string }).id
    const id = messageId(m, 0)
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
    // stable
    expect(messageId({ ...m }, 0)).toBe(id)
  })

  test("hasRolloverContext detects prefix", () => {
    const m: NMessage = { id: "x", role: "user", parts: [{ type: "text", text: "<rollover_context epoch='1'>hi" }], createdAt: 0 }
    expect(hasRolloverContext(m)).toBe(true)
    const m2: NMessage = { id: "y", role: "user", parts: [{ type: "text", text: "hello" }], createdAt: 0 }
    expect(hasRolloverContext(m2)).toBe(false)
  })

  test("projected session context maps to NMessages for extraction", () => {
    const projected = [
      { id: "msg_1", type: "user", text: "question", time: { created: 10 } },
      {
        id: "msg_2",
        type: "assistant",
        time: { created: 20 },
        content: [
          { type: "text", text: "answer" },
          { type: "reasoning", text: "thinking" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: { status: "completed", input: { path: "src/a.ts" }, content: [{ type: "text", text: "file body" }] },
          },
        ],
      },
      { id: "msg_3", type: "idle", outcome: "succeeded", time: { created: 30 } },
    ]
    const out = normalizeProjectedMessages(projected)
    expect(out.length).toBe(2)
    expect(out[0]).toMatchObject({ id: "msg_1", role: "user", parts: [{ type: "text", text: "question" }] })
    expect(out[1].role).toBe("assistant")
    expect(out[1].parts[0]).toEqual({ type: "text", text: "answer" })
    expect(out[1].parts[1]).toEqual({ type: "other", text: "thinking" })
    expect(out[1].parts[2]).toMatchObject({ type: "tool", tool: "read", callId: "call_1", status: "completed", input: { path: "src/a.ts" } })
    expect(out[1].parts[2].output).toContain("file body")
  })

  test("isSyntheticWake detects shell completion", () => {
    const m: NMessage = { id: "x", role: "user", parts: [{ type: "text", text: '<shell id="sh_1" state="completed" command="x">' }], createdAt: 0 }
    expect(isSyntheticWake(m)).toBe(true)
    const m2: NMessage = { id: "y", role: "user", parts: [{ type: "text", text: "hello" }], createdAt: 0 }
    expect(isSyntheticWake(m2)).toBe(false)
  })
})
