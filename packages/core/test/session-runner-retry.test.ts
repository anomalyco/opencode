import { describe, expect, test } from "bun:test"
import { AIError, QuotaExceededError } from "@opencode/ai"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { isRetryable, policy } from "@opencode/core/session/runner/retry"
import { SessionSchema } from "@opencode/core/session/schema"
import { Agent } from "@opencode/schema/agent"
import { Effect } from "effect"

const model = Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") })
const quota = (retryAfterMs?: number) =>
  new AIError({
    reason: new QuotaExceededError({
      message: "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests.",
      retryAfterMs,
    }),
  })

describe("SessionRunnerRetry", () => {
  test("retries quota failures only when the provider scheduled a retry within the maximum wait", () => {
    expect(isRetryable(quota(0))).toBe(true)
    expect(isRetryable(quota(38_602))).toBe(true)
    // Inclusive boundary at RETRY_AFTER_MAX (15 minutes).
    expect(isRetryable(quota(900_000))).toBe(true)
    expect(isRetryable(quota(900_001))).toBe(false)
    expect(isRetryable(quota())).toBe(false)
    // Gemini daily free-tier windows schedule hours out.
    expect(isRetryable(quota(4 * 60 * 60_000))).toBe(false)
  })

  test("policy waits out the scheduled delay before the next attempt", async () => {
    const decide = await Effect.runPromise(policy(SessionSchema.ID.make("ses_retry_test")))
    const cause = quota(38_602)
    const decision = await Effect.runPromise(
      decide({
        cause,
        error: toSessionError(cause),
        agent: Agent.ID.make("build"),
        model,
        hook: () => Effect.void,
        retry: true,
      }),
    )
    expect(decision).toMatchObject({ retry: true, delay: 38_602 })
  })
})
