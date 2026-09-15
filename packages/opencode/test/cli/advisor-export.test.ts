import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionAdvisor } from "../../src/session/advisor"
import { sanitizePart } from "../../src/cli/cmd/export"

function encryptedPart() {
  return Schema.decodeUnknownSync(SessionV1.ToolPart)({
    id: "prt_fixture",
    messageID: "msg_fixture",
    sessionID: "ses_fixture",
    type: "tool",
    tool: "advisor",
    callID: "srv_fixture",
    metadata: {
      providerExecuted: true,
      opencodeAdvisor: {
        version: 1,
        providerID: "anthropic",
        executorModelID: "claude-sonnet-4-6",
        endpoint: SessionAdvisor.endpoint,
        model: "claude-opus-4-6",
        maxUses: 3,
        state: "completed",
        result: { type: "advisor_redacted_result", encryptedContent: "opaque-fixture" },
      },
    },
    state: {
      status: "completed",
      input: {},
      title: "Advisor",
      output: "opaque-fixture",
      metadata: { encryptedContent: "opaque-fixture" },
      time: { start: 0, end: 1 },
    },
  })
}

test("sharing removes encrypted payloads without changing local replay data", () => {
  const part = encryptedPart()
  const before = JSON.stringify(part)
  const shared = SessionAdvisor.forShare(part)
  expect(JSON.stringify(shared)).not.toContain("opaque-fixture")
  expect(shared).toMatchObject({
    metadata: { providerExecuted: true, opencodeAdvisor: { version: 1, redacted: true } },
    state: { output: "[Advisor consultation completed; advice is encrypted.]" },
  })
  expect(JSON.stringify(part)).toBe(before)
  expect(SessionAdvisor.call(part)).toBeDefined()
  if (shared.type !== "tool") throw new Error("Expected shared tool part")
  expect(SessionAdvisor.call(shared)).toBeUndefined()
})

test("sanitized export retains non-replayable native provenance", () => {
  const safe = sanitizePart(encryptedPart())
  expect(JSON.stringify(safe)).not.toContain("opaque-fixture")
  expect(safe).toMatchObject({ metadata: { providerExecuted: true, opencodeAdvisor: { version: 1, redacted: true } } })
})

test("sharing strips raw response ledgers and preserves the authoritative cost", () => {
  const step = Schema.decodeUnknownSync(SessionV1.StepFinishPart)({
    id: "prt_step",
    messageID: "msg_fixture",
    sessionID: "ses_fixture",
    type: "step-finish",
    reason: "stop",
    cost: 0.014625,
    tokens: { input: 20, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    metadata: { opencodeAdvisor: { version: 1, privatePayload: "opaque-fixture" } },
  })
  expect(JSON.stringify(SessionAdvisor.forShare(step))).not.toContain("opaque-fixture")
  expect(SessionAdvisor.forShare(step)).toMatchObject({ cost: 0.014625 })
  expect(JSON.stringify(sanitizePart(step))).not.toContain("opaque-fixture")
})
