import { describe, test, expect } from "bun:test"
import {
  MessageEnvelopeSchema,
  MessagePayloadSchema,
  TaskPayloadSchema,
  TaskResultPayloadSchema,
  TaskProgressPayloadSchema,
  DelegatePayloadSchema,
  HandoffPayloadSchema,
  ShareRequestPayloadSchema,
  ShareResultPayloadSchema,
  ContextRequestPayloadSchema,
  ContextResponsePayloadSchema,
  AgentRegisterPayloadSchema,
  AgentHeartbeatPayloadSchema,
  ErrorPayloadSchema,
  DeadLetterPayloadSchema,
  AgentCapabilitiesSchema,
  validateMessage,
  generateIdempotencyKey,
  validateProtocolVersion,
} from "../../src/protocol/schema.js"

const validEnvelope = {
  id: "uuid-1",
  type: "message",
  from: "agent-a",
  to: "agent-b",
  timestamp: Date.now(),
  hop_count: 0,
  idempotency_key: "abc123",
  priority: "normal",
  protocol_version: 1,
  payload: { content: "hello" },
}

describe("MessageEnvelopeSchema", () => {
  test("parses valid envelope", () => {
    expect(MessageEnvelopeSchema.parse(validEnvelope)).toBeTruthy()
  })

  test("rejects missing required fields", () => {
    for (const field of ["id", "type", "from", "to", "timestamp"]) {
      const copy = { ...validEnvelope }
      delete (copy as any)[field]
      expect(() => MessageEnvelopeSchema.parse(copy)).toThrow()
    }
  })

  test("allows optional fields", () => {
    const withOptional = { ...validEnvelope, ttl: 3600, correlation_id: "corr-1" }
    expect(MessageEnvelopeSchema.parse(withOptional)).toBeTruthy()
  })
})

describe("Payload schemas", () => {
  test("MessagePayloadSchema accepts content", () => {
    expect(MessagePayloadSchema.parse({ content: "hello" })).toBeTruthy()
  })

  test("TaskPayloadSchema rejects missing title", () => {
    expect(() => TaskPayloadSchema.parse({ task_id: "t1", description: "d", priority: "normal" })).toThrow()
  })

  test("TaskPayloadSchema accepts optional fields", () => {
    const r = TaskPayloadSchema.parse({
      task_id: "t1",
      title: "t",
      description: "d",
      priority: "normal",
      deadline: 123,
      budget: { max_tokens: 100 },
    })
    expect(r.deadline).toBe(123)
  })

  test("TaskResultPayloadSchema accepts valid status", () => {
    for (const s of ["completed", "failed", "cancelled", "partial"]) {
      expect(TaskResultPayloadSchema.parse({ task_id: "t1", status: s, summary: "done" })).toBeTruthy()
    }
  })

  test("TaskResultPayloadSchema rejects invalid status", () => {
    expect(() => TaskResultPayloadSchema.parse({ task_id: "t1", status: "unknown", summary: "done" })).toThrow()
  })

  test("TaskProgressPayloadSchema validates status", () => {
    expect(TaskProgressPayloadSchema.parse({ task_id: "t1", status: "working", message: "m" })).toBeTruthy()
    expect(() => TaskProgressPayloadSchema.parse({ task_id: "t1", status: "unknown", message: "m" })).toThrow()
  })

  test("DelegatePayloadSchema validates max_depth > 0", () => {
    expect(() =>
      DelegatePayloadSchema.parse({
        task: { task_id: "t1", title: "t", description: "d", priority: "normal" },
        max_depth: 0,
        return_to: "a",
      }),
    ).toThrow()
    expect(
      DelegatePayloadSchema.parse({
        task: { task_id: "t1", title: "t", description: "d", priority: "normal" },
        max_depth: 1,
        return_to: "a",
      }),
    ).toBeTruthy()
  })

  test("DelegatePayloadSchema requires return_to", () => {
    expect(() =>
      DelegatePayloadSchema.parse({
        task: { task_id: "t1", title: "t", description: "d", priority: "normal" },
        max_depth: 1,
      }),
    ).toThrow()
  })

  test("HandoffPayloadSchema validates next_steps", () => {
    const valid = {
      task_id: "t1",
      reason: "r",
      progress: { description: "d", files_modified: [], files_created: [], next_steps: ["step1"], blockers: [] },
      transfer_worktree: false,
    }
    expect(HandoffPayloadSchema.parse(valid)).toBeTruthy()
    const noSteps = { ...valid, progress: { ...valid.progress, next_steps: [] } }
    expect(() => HandoffPayloadSchema.parse(noSteps)).toThrow()
  })

  test("ShareRequestPayloadSchema validates files not empty", () => {
    expect(() =>
      ShareRequestPayloadSchema.parse({ branch: "b", description: "d", auto_merge: true, files: [] }),
    ).toThrow()
  })

  test("ShareResultPayloadSchema accepts valid status", () => {
    for (const s of ["merged", "conflict", "validation_failed", "rejected"]) {
      expect(ShareResultPayloadSchema.parse({ request_id: "r1", status: s })).toBeTruthy()
    }
  })

  test("ContextRequestPayloadSchema validates scope", () => {
    expect(ContextRequestPayloadSchema.parse({ query: "q", scope: "team" })).toBeTruthy()
    expect(() => ContextRequestPayloadSchema.parse({ query: "q", scope: "invalid" })).toThrow()
  })

  test("ContextResponsePayloadSchema requires result", () => {
    expect(() => ContextResponsePayloadSchema.parse({ query: "q", result: "", source: { agent: "a" } })).toThrow()
  })

  test("AgentRegisterPayloadSchema validates role not empty", () => {
    const base = {
      agent_id: "a1",
      role_priority: 10,
      capabilities: { tools: ["read"] },
      max_concurrent_tasks: 1,
      workspace_path: "/tmp",
    }
    expect(() => AgentRegisterPayloadSchema.parse({ ...base, role: "" })).toThrow()
    expect(AgentRegisterPayloadSchema.parse({ ...base, role: "coder" })).toBeTruthy()
  })

  test("AgentHeartbeatPayloadSchema validates status", () => {
    expect(AgentHeartbeatPayloadSchema.parse({ agent_id: "a1", status: "idle" })).toBeTruthy()
    expect(() => AgentHeartbeatPayloadSchema.parse({ agent_id: "a1", status: "dead" })).toThrow()
  })

  test("ErrorPayloadSchema requires message", () => {
    expect(() => ErrorPayloadSchema.parse({})).toThrow()
    expect(ErrorPayloadSchema.parse({ message: "err" })).toBeTruthy()
  })

  test("DeadLetterPayloadSchema includes original envelope", () => {
    const dl = DeadLetterPayloadSchema.parse({ reason: "unknown agent", original_envelope: validEnvelope })
    expect(dl.original_envelope).toBeTruthy()
  })
})

describe("AgentCapabilitiesSchema", () => {
  test("has correct defaults", () => {
    const caps = AgentCapabilitiesSchema.parse({})
    expect(caps.tools).toEqual(["read", "glob", "grep", "list"])
    expect(caps.max_delegation_depth).toBe(2)
    expect(caps.disk_quota_mb).toBe(500)
  })
})

describe("Protocol version", () => {
  test("only accepts version 1", () => {
    expect(validateProtocolVersion(1)).toBe(true)
    expect(validateProtocolVersion(2)).toBe(false)
    expect(validateProtocolVersion(0)).toBe(false)
  })
})

describe("Idempotency key", () => {
  test("is deterministic", () => {
    const key1 = generateIdempotencyKey("hello", "agent-a", "message")
    const key2 = generateIdempotencyKey("hello", "agent-a", "message")
    expect(key1).toBe(key2)
  })

  test("different inputs produce different keys", () => {
    const key1 = generateIdempotencyKey("hello", "agent-a", "message")
    const key2 = generateIdempotencyKey("world", "agent-a", "message")
    expect(key1).not.toBe(key2)
  })
})

describe("Unknown fields", () => {
  test("unknown fields in payload are ignored", () => {
    const result = MessagePayloadSchema.parse({ content: "hi", unknown_field: "value" })
    expect((result as any).unknown_field).toBeUndefined()
  })
})
