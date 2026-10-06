import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageV2 } from "./message-v2"
import type { Provider } from "@/provider/provider"
import { SessionID, MessageID, PartID } from "./schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

// fix5-empty-assistant-guard regression tests (typed fixtures per review F2)
const sessionID = SessionID.make("session")
const providerID = ProviderV2.ID.make("kimi-for-coding")
const model: Provider.Model = {
  id: ModelV2.ID.make("k3-256k"),
  providerID,
  api: {
    id: "k3-256k",
    url: "https://api.kimi.com/coding/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function userInfo(id: string): SessionV1.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID, modelID: ModelV2.ID.make("test") },
    tools: {},
    mode: "",
  } as unknown as SessionV1.User
}

function assistantInfo(
  id: string,
  parentID: string,
  meta?: { providerID: string; modelID: string },
): SessionV1.Assistant {
  const infoModel = meta ?? { providerID: model.providerID, modelID: model.api.id }
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID,
    modelID: infoModel.modelID,
    providerID: infoModel.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as SessionV1.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id: PartID.make(id.startsWith("prt") ? id : `prt_${id}`),
    sessionID,
    messageID: MessageID.make(messageID.startsWith("msg") ? messageID : `msg_${messageID}`),
  }
}

let n = 0
function assistant(parts: object[], meta?: { providerID: string; modelID: string }): SessionV1.WithParts {
  n++
  return {
    info: assistantInfo(`msg_a${n}`, "msg_parent", meta),
    parts: parts.map((p, i) => ({ ...basePart(`msg_a${n}`, `p${i}`), ...p })) as SessionV1.Part[],
  }
}
function user(text: string): SessionV1.WithParts {
  n++
  return {
    info: userInfo(`msg_u${n}`),
    parts: [{ ...basePart(`msg_u${n}`, "pt"), type: "text", text }] as SessionV1.Part[],
  }
}

function textParts(out: { role: string; parts: Array<{ type: string; text?: string }> }[]) {
  return out.flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => (p.text ?? "").trim()))
}


function noEmptyAssistants(out: object[]) {
  return out.every((m: object) => {
    const mm = m as { role: string; content?: unknown }
    if (mm.role !== "assistant") return true
    if (typeof mm.content === "string") return mm.content.length > 0
    return Array.isArray(mm.content) && mm.content.length > 0
  })
}

describe("fix5-empty-assistant-guard", () => {
  test("assistant with only a step-start part is dropped", async () => {
    const out = await MessageV2.toModelMessages([user("hi"), assistant([{ type: "step-start" }]), user("again")], model)
    expect(out.map((m: { role: string }) => m.role)).toEqual(["user", "user"])
  })

  test("assistant with only an empty text part is dropped", async () => {
    const out = await MessageV2.toModelMessages([user("hi"), assistant([{ type: "text", text: "" }])], model)
    expect(out.length).toBe(1)
  })

  test("whitespace-only text is dropped", async () => {
    const out = await MessageV2.toModelMessages([assistant([{ type: "text", text: "   " }])], model)
    expect(out.length).toBe(0)
  })

  test("assistant with non-empty text is kept", async () => {
    const out = await MessageV2.toModelMessages([assistant([{ type: "text", text: "hello" }])], model)
    expect(out.length).toBe(1)
  })

  test("assistant with a completed tool call is kept", async () => {
    const out = await MessageV2.toModelMessages(
      [
        assistant([
          { type: "step-start" },
          { type: "tool", tool: "bash", callID: "c1", state: { status: "completed", input: {}, output: "ok", time: { start: 0, end: 1 } } },
        ]),
      ],
      model,
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
  })

  test("F1: empty signed reasoning is retained (same model)", async () => {
    const out = await MessageV2.toModelMessages(
      [
        assistant([
          { type: "step-start" },
          { type: "reasoning", text: "", metadata: { anthropic: { signature: "sig123" } } },
          { type: "text", text: "", metadata: {} },
        ]),
      ],
      model,
    )
    expect(out.length).toBe(1)
    expect(noEmptyAssistants(out)).toBe(true)
    expect(JSON.stringify(out)).toContain("sig123")
  })

  test("F1: empty redacted reasoning is retained (same model)", async () => {
    const out = await MessageV2.toModelMessages(
      [assistant([{ type: "reasoning", text: "", metadata: { anthropic: { redactedData: "blob" } } }])],
      model,
    )
    expect(out.length).toBe(1)
  })

  test("F1: signed reasoning is dropped after model switch (different model)", async () => {
    const out = await MessageV2.toModelMessages(
      [
        assistant(
          [{ type: "step-start" }, { type: "reasoning", text: "", metadata: { anthropic: { signature: "sig" } } }, { type: "text", text: "" }],
          { providerID: "other", modelID: "other-model" },
        ),
      ],
      model,
    )
    expect(out.length).toBe(0)
  })

  test("F3: empty sibling step is dropped, content step kept", async () => {
    const out = await MessageV2.toModelMessages(
      [assistant([{ type: "step-start" }, { type: "text", text: "" }, { type: "step-start" }, { type: "text", text: "hello" }])],
      model,
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(noEmptyAssistants(out)).toBe(true)
    expect(JSON.stringify(out)).toContain("hello")
  })

  test("F3: empty first, middle and last steps — only content survives", async () => {
    const out = await MessageV2.toModelMessages(
      [
        assistant([
          { type: "step-start" },
          { type: "text", text: "" },
          { type: "step-start" },
          { type: "text", text: "middle" },
          { type: "step-start" },
          { type: "text", text: "  " },
        ]),
      ],
      model,
    )
    expect(noEmptyAssistants(out)).toBe(true)
    expect(JSON.stringify(out)).toContain("middle")
  })

  test("zero-part assistant is dropped (pre-existing behavior preserved)", async () => {
    const out = await MessageV2.toModelMessages([user("hi"), { info: assistantInfo("msg_z", "p"), parts: [] }], model)
    expect(out.length).toBe(1)
  })
})
