import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const decodeUser = Schema.decodeUnknownExit(SessionV1.User)
const encodeUser = Schema.encodeUnknownSync(SessionV1.User)
const decodePart = Schema.decodeUnknownExit(SessionV1.Part)

describe("structured-output-retry.OutputFormat round-trip", () => {
  // Regression test for #26929: OutputFormatJsonSchema was a Schema.Class,
  // so encoding a plain object pulled from the DB crashed Effect's encoder.
  test("encodes a User message with json_schema format from a plain object", () => {
    const userPlain = {
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user" as const,
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
      format: {
        type: "json_schema" as const,
        schema: { type: "object", properties: { answer: { type: "number" } } },
        retryCount: 1,
      },
    }

    const decoded = decodeUser(userPlain)
    expect(Exit.isSuccess(decoded)).toBe(true)
    if (!Exit.isSuccess(decoded)) return

    const encoded = encodeUser(decoded.value) as Record<string, unknown>
    expect(encoded.role).toBe("user")
    const encodedFormat = encoded.format as Record<string, unknown>
    expect(encodedFormat.type).toBe("json_schema")
    expect(encodedFormat.retryCount).toBe(1)
    expect(encodedFormat.schema).toEqual({
      type: "object",
      properties: { answer: { type: "number" } },
    })

    const reDecoded = decodeUser(encoded)
    expect(Exit.isSuccess(reDecoded)).toBe(true)
    if (!Exit.isSuccess(reDecoded)) return
    expect(reDecoded.value.format).toEqual(decoded.value.format)
  })

  test("encodes text format from a plain object", () => {
    const userPlain = {
      id: MessageID.ascending(),
      sessionID: SessionID.descending(),
      role: "user" as const,
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
      format: { type: "text" as const },
    }

    const decoded = decodeUser(userPlain)
    expect(Exit.isSuccess(decoded)).toBe(true)
    if (!Exit.isSuccess(decoded)) return

    const encoded = encodeUser(decoded.value) as Record<string, unknown>
    expect((encoded.format as Record<string, unknown>).type).toBe("text")
  })
})

describe("structured-output-retry.reminder shape", () => {
  // Documents the structural contract for the synthetic user message
  // runLoop inserts on a structured-output failure: a User with format preserved
  // plus a synthetic text part.
  test("synthetic reminder message + part decode and carry the prior format", () => {
    const sessionID = SessionID.descending()
    const priorFormat = {
      type: "json_schema" as const,
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      retryCount: 2,
    }

    const reminderMsg = {
      id: MessageID.ascending(),
      sessionID,
      role: "user" as const,
      time: { created: Date.now() },
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-3" },
      format: priorFormat,
    }
    const reminderPart = {
      id: PartID.ascending(),
      messageID: reminderMsg.id,
      sessionID,
      type: "text" as const,
      text: "any reminder text",
      synthetic: true,
    }

    const decodedMsg = decodeUser(reminderMsg)
    expect(Exit.isSuccess(decodedMsg)).toBe(true)
    if (!Exit.isSuccess(decodedMsg)) return
    expect(decodedMsg.value.format?.type).toBe("json_schema")
    if (decodedMsg.value.format?.type === "json_schema") {
      expect(decodedMsg.value.format.retryCount).toBe(2)
      expect(decodedMsg.value.format.schema).toEqual(priorFormat.schema)
    }

    const decodedPart = decodePart(reminderPart)
    expect(Exit.isSuccess(decodedPart)).toBe(true)
    if (!Exit.isSuccess(decodedPart)) return
    if (decodedPart.value.type !== "text") throw new Error("expected text part")
    expect(decodedPart.value.synthetic).toBe(true)
  })
})

describe("structured-output-retry.StructuredOutputError retries", () => {
  // Issue #25430: previously the error was constructed with `retries: 0` unconditionally.
  // After the fix, the loop increments structuredRetry up to format.retryCount and
  // reports that count when finally giving up. Verify the error preserves the count.
  test("error preserves the attempted retry count", () => {
    for (const retries of [0, 1, 2, 5]) {
      const err = new SessionV1.StructuredOutputError({
        message: "Model did not produce structured output",
        retries,
      })
      expect(err.data.retries).toBe(retries)
      const obj = err.toObject()
      expect(obj.data.retries).toBe(retries)
    }
  })

  test("default retryCount from OutputFormatJsonSchema is 2", () => {
    const decoded = Schema.decodeUnknownSync(SessionV1.OutputFormatJsonSchema)({
      type: "json_schema",
      schema: { type: "object" },
    })
    expect(decoded.retryCount).toBe(2)
  })
})
