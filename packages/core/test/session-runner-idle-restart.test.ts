import { describe, expect, it } from "bun:test"
import { InvalidRequestReason, LLMError, TransportReason } from "@opencode-ai/llm"
import { shouldRestartStalledStream, STREAM_IDLE_RETRIES } from "@opencode-ai/core/session/runner/llm"

const idleTimeout = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new TransportReason({ message: "Provider stream stalled", kind: "IdleTimeout" }),
  })

const restart = (failure: unknown, overrides?: Partial<Parameters<typeof shouldRestartStalledStream>[0]>) =>
  shouldRestartStalledStream({
    failure,
    assistantStarted: false,
    retry: 0,
    interrupted: false,
    providerOverflow: false,
    ...overrides,
  })

describe("shouldRestartStalledStream", () => {
  it("restarts a pre-output idle timeout while the budget remains", () => {
    expect(restart(idleTimeout())).toBe(true)
    expect(restart(idleTimeout(), { retry: STREAM_IDLE_RETRIES - 1 })).toBe(true)
  })

  it("never restarts once the retry budget is exhausted", () => {
    expect(restart(idleTimeout(), { retry: STREAM_IDLE_RETRIES })).toBe(false)
    expect(restart(idleTimeout(), { retry: STREAM_IDLE_RETRIES + 1 })).toBe(false)
  })

  it("never restarts after assistant output started", () => {
    expect(restart(idleTimeout(), { assistantStarted: true })).toBe(false)
  })

  it("never restarts an interrupted stream", () => {
    expect(restart(idleTimeout(), { interrupted: true })).toBe(false)
  })

  it("never restarts after a provider overflow event", () => {
    expect(restart(idleTimeout(), { providerOverflow: true })).toBe(false)
  })

  it("only restarts on the typed IdleTimeout transport failure", () => {
    expect(
      restart(
        new LLMError({
          module: "test",
          method: "stream",
          reason: new TransportReason({ message: "Provider unavailable" }),
        }),
      ),
    ).toBe(false)
    expect(
      restart(
        new LLMError({
          module: "test",
          method: "stream",
          reason: new InvalidRequestReason({ message: "prompt too long", classification: "context-overflow" }),
        }),
      ),
    ).toBe(false)
    expect(restart(new Error("unexpected"))).toBe(false)
    expect(restart(undefined)).toBe(false)
  })
})
