import { test, expect } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { Schema } from "effect"
import { MessageV2 } from "@/session/message-v2"
import {
  parseShareUrl,
  shouldAttachShareAuthHeaders,
  transformShareData,
  type ShareData,
} from "../../src/cli/cmd/import"

// parseShareUrl tests
test("parses valid share URLs", () => {
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://custom.example.com/share/abc123")).toBe("abc123")
  expect(parseShareUrl("http://localhost:3000/share/test_id-123")).toBe("test_id-123")
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://opncd.ai/s/Jsj3hNIW")).toBeNull() // legacy format
  expect(parseShareUrl("https://opncd.ai/share/")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/id/extra")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

test("only attaches share auth headers for same-origin URLs", () => {
  expect(shouldAttachShareAuthHeaders("https://control.example.com/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("https://other.example.com/share/abc", "https://control.example.com")).toBe(false)
  expect(shouldAttachShareAuthHeaders("https://control.example.com:443/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("not-a-url", "https://control.example.com")).toBe(false)
})

// transformShareData tests
test("transforms share data to storage format", () => {
  const data: ShareData[] = [
    { type: "session", data: { id: "sess-1", title: "Test" } as any },
    { type: "message", data: { id: "msg-1", sessionID: "sess-1" } as any },
    { type: "part", data: { id: "part-1", messageID: "msg-1" } as any },
    { type: "part", data: { id: "part-2", messageID: "msg-1" } as any },
  ]

  const result = transformShareData(data)!

  expect(result.info.id).toBe("sess-1")
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts).toHaveLength(2)
})

test("returns null for invalid share data", () => {
  expect(transformShareData([])).toBeNull()
  expect(transformShareData([{ type: "message", data: {} as any }])).toBeNull()
  expect(transformShareData([{ type: "session", data: { id: "s" } as any }])).toBeNull() // no messages
})

test("normalizes legacy messages missing agent before decoding", () => {
  const messages: Array<{ info: Message; parts: Part[] }> = [
    {
      info: {
        role: "user",
        time: { created: 1 },
        id: "msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M",
        sessionID: "ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K",
      } as unknown as Message,
      parts: [],
    },
    {
      info: {
        role: "assistant",
        time: { created: 2, completed: 3 },
        modelID: "grok-code",
        providerID: "opencode",
        mode: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        id: "msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2N",
        sessionID: "ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K",
      } as unknown as Message,
      parts: [],
    },
  ]
  const decode = Schema.decodeUnknownSync(MessageV2.Info)

  expect(decode(MessageV2.normalizeInfoForRead(messages[0].info, messages, 0))).toMatchObject({
    agent: "build",
    model: { providerID: "opencode", modelID: "grok-code" },
  })
  expect(decode(MessageV2.normalizeInfoForRead(messages[1].info, messages, 1))).toMatchObject({
    agent: "build",
    parentID: "msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M",
  })
})

test("normalizes legacy step finish parts missing reason before decoding", () => {
  const decode = Schema.decodeUnknownSync(MessageV2.Part)

  expect(
    decode(
      MessageV2.normalizePartForRead({
        type: "step-finish",
        cost: 0,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        id: "prt_01J5Y5H0AH4Q4NXJ6P4C3P5V2N",
        sessionID: "ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K",
        messageID: "msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M",
      } as unknown as Part),
    ),
  ).toMatchObject({ reason: "stop" })
})
