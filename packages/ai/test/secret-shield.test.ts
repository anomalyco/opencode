import { describe, expect, test } from "bun:test"
import { LLMRequest, Message, SystemPart, ToolCallPart, ToolDefinition, ToolResultPart } from "../src/effect.js"
import { OpenAIChat } from "../src/protocols.js"
import { Auth } from "../src/route.js"
import { REDACTED, applySecretShield, redact, redactMessages, redactTools, scan } from "../src/secret-shield.js"
import type { ShieldResult } from "../src/secret-shield.js"

const fakeModel = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://test.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "fake" })

const makeRequest = (text: string, system?: string) =>
  LLMRequest.update(
    new LLMRequest({
      model: fakeModel,
      system: system ? [SystemPart.make(system)] : [],
      messages: [Message.user(text)],
      tools: [],
    }),
    {},
  )

const ok = (result: ShieldResult) => {
  expect(result._tag).toBe("ok")
  return result as Extract<ShieldResult, { _tag: "ok" }>
}

// ── Pattern families ────────────────────────────────────────────────────────

describe("pattern families", () => {
  test("api key prefixes", () => {
    for (const key of [
      "sk-proj-" + "a".repeat(30),
      "ghp_" + "a".repeat(30),
      "AKIA" + "A".repeat(16),
      "glpat-" + "a".repeat(24),
      "hf_" + "a".repeat(24),
    ]) {
      const r = redact(`key is ${key}`)
      expect(r.text).not.toContain(key)
      expect(r.count).toBeGreaterThanOrEqual(1)
    }
  })

  test("json sensitive fields", () => {
    const r = redact('{"password":"mysecret","api_key":"sk-abc123","port":5432}')
    expect(r.text).not.toContain("mysecret")
    expect(r.text).toContain("port")
  })

  test("http headers and auth schemes", () => {
    expect(redact("Authorization: Bearer my_token_value_here_1234").text).toContain(REDACTED)
    expect(redact("X-Api-Key: abcdefghij123456").text).toContain(REDACTED)
  })

  test("connection string uris", () => {
    const r = redact("postgres://admin:s3cret@db.example.com:5432/mydb")
    expect(r.text).not.toContain("s3cret")
    expect(r.text).toContain("@db.example.com")
  })

  test("jwt tokens", () => {
    const h = btoa(JSON.stringify({ alg: "HS256" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const jwt = `${h}.eyJzdWIiOiJ4In0.signature`
    expect(redact(`token: ${jwt}`).text).not.toContain(jwt)
  })
})

// ── Left-boundary false positives ───────────────────────────────────────────

describe("false positive boundaries", () => {
  test("sk- inside identifiers", () => {
    expect(redact("risk-assessment-module is fine").count).toBe(0)
    expect(redact("disk-usage-monitor running").count).toBe(0)
    expect(redact("task-scheduler-service-abcdef").count).toBe(0)
  })

  test("auth scheme prose", () => {
    expect(redact("Use Basic authentication for the admin panel").count).toBe(0)
    expect(redact("OAuth integration and bearer authentication").count).toBe(0)
    expect(redact("Add Basic authentication to the admin page").count).toBe(0)
    expect(redact("Bearer re-authentication").count).toBe(0)
  })

  test("header-like type declarations", () => {
    expect(redact("authorization: string").count).toBe(0)
    expect(redact("authorization: string;").count).toBe(0)
    expect(redact("cookie: string").count).toBe(0)
    expect(redact('Authorization: `Bearer ${apiKey}`').count).toBe(0)
  })

  test("empty json sensitive values", () => {
    expect(redact('"token": ""').count).toBe(0)
    expect(redact('"password": ""').count).toBe(0)
  })

  test("clean passthrough", () => {
    expect(redact("Hello, review this code.").count).toBe(0)
    expect(redact("port=5432 host=localhost").count).toBe(0)
    expect(redact("The password is hashed with bcrypt").count).toBe(0)
  })
})

// ── Tool result scanning ────────────────────────────────────────────────────

describe("tool result scanning", () => {
  test("redacts credentials in tool-result text", () => {
    const key = "sk-proj-" + "a".repeat(30)
    const messages = [
      Message.tool({ id: "call_1", name: "bash", result: `OPENAI_API_KEY=${key}`, resultType: "text" }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(r.messages)).not.toContain(key)
  })

  test("redacts credentials in tool-result json", () => {
    const key = "ghp_" + "a".repeat(30)
    const messages = [
      Message.tool({ id: "call_2", name: "read", result: { content: `token=${key}` }, resultType: "json" }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(r.messages)).not.toContain(key)
  })

  test("preserves object structure when masking tool-result json", () => {
    const key = "ghp_" + "a".repeat(30)
    const messages = [
      Message.tool({ id: "call_2", name: "read", result: { secret: key, safe: 42 }, resultType: "json" }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBeGreaterThanOrEqual(1)
    const resultPart = r.messages[0]!.content[0]! as { result: { value: unknown } }
    const value = resultPart.result.value as Record<string, unknown>
    expect(typeof value).toBe("object")
    expect(value.safe).toBe(42)
    expect(value.secret).toContain(REDACTED)
  })

  test("preserves object structure when masking tool-call input", () => {
    const key = "ghp_" + "a".repeat(30)
    const messages = [
      Message.make({
        role: "assistant",
        content: [{ type: "tool-call", id: "c1", name: "bash", input: { command: `curl -H 'Authorization: Bearer ${key}'` } }],
      }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBeGreaterThanOrEqual(1)
    const callPart = r.messages[0]!.content[0]! as { input: unknown }
    const input = callPart.input as Record<string, unknown>
    expect(typeof input).toBe("object")
    expect(input.command).toContain(REDACTED)
    expect(input.command).not.toContain(key)
  })

  test("skips clean tool results", () => {
    const messages = [Message.tool({ id: "call_3", name: "ls", result: "file.txt\nREADME.md" })]
    const r = redactMessages(messages)
    expect(r.count).toBe(0)
    expect(r.messages).toBe(messages)
  })

  test("masks values under sensitive keys in structured results", () => {
    const messages = [
      Message.tool({ id: "call_4", name: "read", result: { password: "hunter2hunter2", safe: 42 }, resultType: "json" }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBeGreaterThanOrEqual(1)
    const resultPart = r.messages[0]!.content[0]! as { result: { value: unknown } }
    const value = resultPart.result.value as Record<string, unknown>
    expect(value.password).toBe(REDACTED)
    expect(value.safe).toBe(42)
  })
})

// ── Reasoning part scanning ─────────────────────────────────────────────────

describe("reasoning scanning", () => {
  test("redacts credentials in reasoning parts", () => {
    const key = "ghp_" + "a".repeat(30)
    const messages = [
      Message.make({
        role: "assistant",
        content: [{ type: "reasoning", text: `I found the key ${key} in the file` }],
      }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(r.messages)).not.toContain(key)
  })
})

// ── Message and tool scanning ───────────────────────────────────────────────

describe("message scanning", () => {
  test("redacts text in user messages", () => {
    const key = "ghp_" + "a".repeat(30)
    const r = redactMessages([Message.user(`my key is ${key}`)])
    expect(r.count).toBe(1)
    expect(JSON.stringify(r.messages)).toContain(REDACTED)
  })

  test("clean passthrough returns same ref", () => {
    const messages = [Message.user("fix the bug")]
    expect(redactMessages(messages).messages).toBe(messages)
  })
})

describe("tool description scanning", () => {
  test("redacts secret in description", () => {
    const key = "ghp_" + "a".repeat(30)
    const tools = [new ToolDefinition({ name: "t", description: `Use key ${key}`, inputSchema: {} })]
    const r = redactTools(tools)
    expect(r.tools[0]!.description).toContain(REDACTED)
    expect(r.tools[0]!.description).not.toContain(key)
  })
})

// ── Mode behaviours ─────────────────────────────────────────────────────────

describe("applySecretShield modes", () => {
  const key = "ghp_" + "a".repeat(30)

  test("off returns same ref, no scanning", () => {
    const req = makeRequest(`key is ${key}`)
    const result = ok(applySecretShield(req, "off"))
    expect(result.request).toBe(req)
    expect(result.report.detected).toBe(0)
  })

  test("warn detects but does not modify", () => {
    const req = makeRequest(`key is ${key}`)
    const result = ok(applySecretShield(req, "warn"))
    expect(result.request).toBe(req)
    expect(result.report.detected).toBe(1)
    expect(JSON.stringify(result.request.messages)).toContain(key)
  })

  test("mask replaces secrets", () => {
    const req = makeRequest(`key is ${key}`)
    const result = ok(applySecretShield(req, "mask"))
    expect(result.report.detected).toBe(1)
    expect(JSON.stringify(result.request.messages)).toContain(REDACTED)
    expect(JSON.stringify(result.request.messages)).not.toContain(key)
  })

  test("mask also redacts system parts", () => {
    const req = makeRequest("hello", `system key ${key}`)
    const result = ok(applySecretShield(req, "mask"))
    expect(JSON.stringify(result.request.system)).toContain(REDACTED)
  })

  test("block rejects on detection", () => {
    const result = applySecretShield(makeRequest(`key is ${key}`), "block")
    expect(result._tag).toBe("blocked")
    expect(result.report.detected).toBe(1)
  })

  test("block passes clean input", () => {
    const req = makeRequest("fix the bug")
    expect(ok(applySecretShield(req, "block")).request).toBe(req)
  })

  test("fail-closed on internal error", () => {
    const req = makeRequest("hello")
    const original = Object.getOwnPropertyDescriptor(req, "messages")!
    Object.defineProperty(req, "messages", { get() { throw new Error("boom") } })
    try {
      const result = applySecretShield(req, "mask")
      expect(result._tag).toBe("blocked")
      expect(result.report.error).toBeDefined()
    } finally {
      Object.defineProperty(req, "messages", original)
    }
  })
})
