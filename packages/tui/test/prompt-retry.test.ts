import { expect, test } from "bun:test"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import type { PromptInfo } from "../src/prompt/history"
import {
  acknowledgePromptRetry,
  clearPromptRetry,
  MAX_TOTAL_PROMPT_RETRIES,
  markPromptRetryRestored,
  releasePromptRetry,
  rememberPromptRetry,
  restorePromptRetry,
  takePromptRetry,
  type PromptRetry,
} from "../src/component/prompt/retry"

const sessionID = "ses_prompt_retry"
const prompt = (text = "retry me"): PromptInfo => ({ text, files: [], agents: [], skills: [], pasted: [] })
const retry = (overrides: Partial<PromptRetry> = {}): PromptRetry => ({
  id: SessionMessage.ID.make("msg_retry"),
  contextID: SessionMessage.ID.make("msg_retry_context"),
  prompt: prompt(),
  agent: "build",
  providerID: "provider",
  modelID: "model",
  variant: "fast",
  delivery: "steer",
  contextKey: "selection",
  contextIncluded: true,
  ...overrides,
})

test("reuses prompt and context IDs only for an unchanged submission", () => {
  clearPromptRetry(sessionID)
  const remembered = retry()
  rememberPromptRetry(sessionID, remembered)
  remembered.prompt.text = "mutated after remembering"

  expect(
    takePromptRetry(sessionID, {
      prompt: prompt(),
      agent: "build",
      providerID: "provider",
      modelID: "model",
      variant: "fast",
      delivery: "steer",
      contextKey: "selection",
    }),
  ).toMatchObject({ id: "msg_retry", contextID: "msg_retry_context" })
})

test("does not reuse or discard retry IDs when submission identity changes", () => {
  const changes: Array<Partial<PromptRetry>> = [
    { prompt: prompt("edited") },
    { agent: "plan" },
    { providerID: "other" },
    { modelID: "other" },
    { variant: "slow" },
    { delivery: "queue" },
    { contextKey: "other selection" },
  ]

  changes.forEach((change) => {
    clearPromptRetry(sessionID)
    rememberPromptRetry(sessionID, retry())
    expect(takePromptRetry(sessionID, { ...retry(), ...change })).toBeUndefined()
    expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_retry" })
  })
})

test("clears only the retry matching an acknowledged prompt", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  clearPromptRetry(sessionID, SessionMessage.ID.make("msg_other"))

  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_retry" })
})

test("retains independent retries for overlapping failed submissions", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry({ id: SessionMessage.ID.make("msg_first"), prompt: prompt("first") }))
  rememberPromptRetry(sessionID, retry({ id: SessionMessage.ID.make("msg_second"), prompt: prompt("second") }))

  expect(takePromptRetry(sessionID, { ...retry(), prompt: prompt("first") })).toMatchObject({ id: "msg_first" })
  expect(takePromptRetry(sessionID, { ...retry(), prompt: prompt("second") })).toMatchObject({ id: "msg_second" })
})

test("preserves failure order when an identical retry fails again", () => {
  clearPromptRetry(sessionID)
  const first = retry({ id: SessionMessage.ID.make("msg_first") })
  rememberPromptRetry(sessionID, first)
  rememberPromptRetry(sessionID, retry({ id: SessionMessage.ID.make("msg_second") }))
  rememberPromptRetry(sessionID, first)

  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_first" })
  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_second" })
})

test("claims a retry identity once across overlapping identical submissions", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())

  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_retry" })
  expect(takePromptRetry(sessionID, retry())).toBeUndefined()
})

test("does not restore a retry after its durable acknowledgement arrives", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  takePromptRetry(sessionID, retry())

  expect(acknowledgePromptRetry(sessionID, SessionMessage.ID.make("msg_retry"))).toMatchObject({
    contextIncluded: true,
  })
  expect(rememberPromptRetry(sessionID, retry())).toBe(false)
  expect(takePromptRetry(sessionID, retry())).toBeUndefined()
})

test("releases a claimed identity when retry preparation fails", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_retry", contextID: "msg_retry_context" })

  releasePromptRetry(sessionID, SessionMessage.ID.make("msg_retry"))

  expect(takePromptRetry(sessionID, retry())).toMatchObject({ id: "msg_retry", contextID: "msg_retry_context" })
})

test("retains automatic restoration ownership until durable acknowledgement", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  markPromptRetryRestored(sessionID, SessionMessage.ID.make("msg_retry"))

  expect(acknowledgePromptRetry(sessionID, SessionMessage.ID.make("msg_retry"))).toMatchObject({ restored: true })
})

test("consumes automatic restoration ownership when the retry is submitted", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  markPromptRetryRestored(sessionID, SessionMessage.ID.make("msg_retry"))

  takePromptRetry(sessionID, retry())

  expect(acknowledgePromptRetry(sessionID, SessionMessage.ID.make("msg_retry"))).toMatchObject({ restored: false })
})

test("does not restore retry text after acknowledgement arrives during preparation", () => {
  clearPromptRetry(sessionID)
  rememberPromptRetry(sessionID, retry())
  takePromptRetry(sessionID, retry())
  acknowledgePromptRetry(sessionID, SessionMessage.ID.make("msg_retry"))
  let restored = false

  expect(
    restorePromptRetry(sessionID, SessionMessage.ID.make("msg_retry"), () => {
      restored = true
      return true
    }),
  ).toBe(false)
  expect(restored).toBe(false)
})

test("bounds retained retries across sessions", () => {
  const sessions = Array.from({ length: MAX_TOTAL_PROMPT_RETRIES + 1 }, (_, index) => `ses_retry_${index}`)
  sessions.forEach((id, index) => {
    clearPromptRetry(id)
    rememberPromptRetry(
      id,
      retry({ id: SessionMessage.ID.make(`msg_retry_${index}`), prompt: prompt(`retry ${index}`) }),
    )
  })

  expect(
    takePromptRetry(sessions[0]!, {
      ...retry(),
      prompt: prompt("retry 0"),
    }),
  ).toBeUndefined()
  expect(
    takePromptRetry(sessions.at(-1)!, {
      ...retry(),
      prompt: prompt(`retry ${MAX_TOTAL_PROMPT_RETRIES}`),
    }),
  ).toMatchObject({ id: `msg_retry_${MAX_TOTAL_PROMPT_RETRIES}` })
  sessions.forEach((id) => clearPromptRetry(id))
})

test("preserves an active claim while evicting idle retries at the global bound", () => {
  const sessions = Array.from({ length: MAX_TOTAL_PROMPT_RETRIES + 1 }, (_, index) => `ses_claim_${index}`)
  sessions.slice(0, -1).forEach((id, index) => {
    clearPromptRetry(id)
    rememberPromptRetry(
      id,
      retry({ id: SessionMessage.ID.make(`msg_claim_${index}`), prompt: prompt(`claim ${index}`) }),
    )
  })
  takePromptRetry(sessions[0]!, { ...retry(), prompt: prompt("claim 0") })
  rememberPromptRetry(
    sessions.at(-1)!,
    retry({
      id: SessionMessage.ID.make(`msg_claim_${MAX_TOTAL_PROMPT_RETRIES}`),
      prompt: prompt(`claim ${MAX_TOTAL_PROMPT_RETRIES}`),
    }),
  )

  expect(restorePromptRetry(sessions[0]!, SessionMessage.ID.make("msg_claim_0"), () => true)).toBe(true)
  expect(takePromptRetry(sessions[1]!, { ...retry(), prompt: prompt("claim 1") })).toBeUndefined()
  sessions.forEach((id) => clearPromptRetry(id))
})
