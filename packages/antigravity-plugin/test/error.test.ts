import { describe, expect, test } from "bun:test"
import { GoogleAntigravityWire } from "../src/wire"

const reset = "2026-08-14T18:00:00Z"
const quotaMessage = "You have exhausted your capacity on this model. Your quota will reset after 5h."

const summary = {
  groups: [
    {
      displayName: "Gemini models",
      buckets: [
        { window: "5h", remainingFraction: 0, resetTime: reset },
        { window: "weekly", remainingFraction: 0.4, resetTime: "2026-08-20T00:00:00Z" },
      ],
    },
  ],
}

describe("Cloud Code 429 bodies", () => {
  test("keeps the Google status and message when they sit past 500 characters", () => {
    const padding = "x".repeat(500)
    const inner = {
      error: {
        code: 429,
        message: quotaMessage,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "QUOTA_EXHAUSTED",
            metadata: { quotaResetTimeStamp: reset },
          },
        ],
      },
    }
    const body = JSON.stringify({
      noise: padding,
      error: { code: 429, message: padding + JSON.stringify(inner), status: "UNKNOWN" },
    })
    expect(body.length).toBeGreaterThan(500)
    expect(body.slice(0, 500).includes("RESOURCE_EXHAUSTED")).toBe(false)

    const parsed = GoogleAntigravityWire.parseCloudCodeError(body)
    expect(parsed).toMatchObject({
      status: "RESOURCE_EXHAUSTED",
      message: quotaMessage,
      reason: "QUOTA_EXHAUSTED",
      resetTime: reset,
    })
    if (!parsed) return
    const explained = GoogleAntigravityWire.explainCloudCodeError({
      error: parsed,
      httpStatus: 429,
      modelID: "gemini-3.8-flash-high",
    })
    expect(explained?.quota).toBe(true)
    expect(explained?.message).toContain(`RESOURCE_EXHAUSTED: ${quotaMessage}`)
    expect(explained?.message).toContain(`resetTime=${reset}`)
  })

  test("reads an SSE error line without trimming the payload to 500 characters", () => {
    const padding = "y".repeat(500)
    const body = `data: ${JSON.stringify({
      error: {
        code: 429,
        message: `${padding} ${quotaMessage}`,
        status: "RESOURCE_EXHAUSTED",
      },
    })}\n\n`
    expect(GoogleAntigravityWire.parseCloudCodeError(body)).toMatchObject({
      status: "RESOURCE_EXHAUSTED",
      message: `${padding} ${quotaMessage}`,
    })
  })

  test.each(["gemini-4-argon-high", "gemini-4-argon-medium", "gemini-4-argon-low", "gemini-3.8-flash-high"])(
    "surfaces remainingFraction and resetTime and marks an empty 5h bucket as quota for %s",
    (modelID) => {
      const explained = GoogleAntigravityWire.explainCloudCodeError({
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Resource has been exhausted (e.g. check quota).",
          reason: "RATE_LIMIT_EXCEEDED",
        },
        summary,
        httpStatus: 429,
        modelID,
      })
      expect(explained?.quota).toBe(true)
      expect(explained?.message).toContain("RESOURCE_EXHAUSTED: Resource has been exhausted (e.g. check quota).")
      expect(explained?.message).toContain("gemini:5h remainingFraction=0 resetTime=2026-08-14T18:00:00Z")
      expect(explained?.message).toContain("gemini:weekly remainingFraction=0.4 resetTime=2026-08-20T00:00:00Z")
      expect(JSON.parse(explained?.body ?? "{}")).toMatchObject({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          details: [{ reason: "QUOTA_EXHAUSTED" }],
        },
      })
    },
  )

  test("keeps a short throttle retryable when the 5h bucket still has quota", () => {
    const explained = GoogleAntigravityWire.explainCloudCodeError({
      error: {
        status: "RESOURCE_EXHAUSTED",
        message: "Resource has been exhausted (e.g. check quota).",
        reason: "RATE_LIMIT_EXCEEDED",
      },
      summary: {
        groups: [
          {
            displayName: "Gemini models",
            buckets: [{ window: "5h", remainingFraction: 0.5, resetTime: reset }],
          },
        ],
      },
      httpStatus: 429,
      modelID: "gemini-4-argon-high",
    })
    expect(explained?.quota).toBe(false)
    expect(explained?.message).toContain("gemini:5h remainingFraction=0.5 resetTime=2026-08-14T18:00:00Z")
    expect(JSON.parse(explained?.body ?? "{}").error.details).toEqual([
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" },
    ])
  })

  test.each([
    {
      modelID: "gemini-4-argon-high",
      groups: [{ displayName: "Claude + GPT", buckets: [{ window: "5h", remainingFraction: 0 }] }],
    },
    {
      modelID: "gemini-3.8-flash-high",
      groups: [{ displayName: "Claude + GPT", buckets: [{ window: "5h", remainingFraction: 0 }] }],
    },
    { modelID: "claude-sonnet-4-6", groups: summary.groups },
    { modelID: "gpt-oss-120b", groups: summary.groups },
    {
      modelID: "gemini-4-argon-high",
      groups: [{ displayName: "Unknown models", buckets: [{ window: "5h", remainingFraction: 0 }] }],
    },
    {
      modelID: "gemini-3.8-flash-high",
      groups: [{ displayName: "Unknown models", buckets: [{ window: "5h", remainingFraction: 0 }] }],
    },
    { modelID: "gemini-4-argon-high", groups: [] },
    { modelID: "gemini-3.8-flash-high", groups: [] },
    { modelID: "unknown-model", groups: summary.groups },
    { modelID: undefined, groups: summary.groups },
  ])("does not borrow quota from an unrelated or missing group: %j", ({ modelID, groups }) => {
    const explained = GoogleAntigravityWire.explainCloudCodeError({
      error: {
        status: "RESOURCE_EXHAUSTED",
        message: "Resource has been exhausted (e.g. check quota).",
        reason: "RATE_LIMIT_EXCEEDED",
      },
      summary: { groups },
      httpStatus: 429,
      modelID,
    })
    expect(explained?.quota).toBe(false)
    expect(JSON.parse(explained?.body ?? "{}").error.details[0].reason).toBe("RATE_LIMIT_EXCEEDED")
  })

  test.each(["claude-sonnet-4-6", "gpt-oss-120b"])("uses the matching third-party group for %s", (modelID) => {
    expect(
      GoogleAntigravityWire.explainCloudCodeError({
        error: { status: "RESOURCE_EXHAUSTED", message: "Resource exhausted" },
        summary: { groups: [{ displayName: "Claude + GPT", buckets: [{ window: "5h", remainingFraction: 0 }] }] },
        httpStatus: 429,
        modelID,
      })?.quota,
    ).toBe(true)
  })

  test.each([
    { reason: "QUOTA_EXHAUSTED", message: "Resource exhausted" },
    { reason: "RATE_LIMIT_EXCEEDED", message: quotaMessage },
  ])("retains affirmative quota evidence without a matching group: %j", (error) => {
    expect(
      GoogleAntigravityWire.explainCloudCodeError({
        error: { status: "RESOURCE_EXHAUSTED", ...error },
        summary: { groups: [] },
        httpStatus: 429,
        modelID: "unknown-model",
      })?.quota,
    ).toBe(true)
  })

  const fullQuota = (remainingFraction: number) => ({
    groups: [{ displayName: "Gemini models", buckets: [{ window: "5h", remainingFraction, resetTime: reset }] }],
  })

  test("fails a bare RESOURCE_EXHAUSTED once when the model's 5h quota is nearly full", () => {
    const explained = GoogleAntigravityWire.explainCloudCodeError({
      error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." },
      summary: fullQuota(0.9998),
      httpStatus: 429,
      modelID: "gemini-3.8-flash-low",
    })
    expect(explained?.quota).toBe(false)
    expect(explained?.rejected).toBe(true)
    expect(explained?.message).toContain("likely not quota: at least 95% of this model's quota is unused")
    expect(explained?.message).toContain("gemini:5h remainingFraction=0.9998")
    expect(JSON.parse(explained?.body ?? "{}").error.details).toEqual([
      { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "CONTENT_BLOCKED" },
    ])
  })

  test.each([
    { modelID: "gemini-3.8-flash-low", group: "Gemini models", fraction: 0.95, rejected: true },
    { modelID: "claude-sonnet-4-6", group: "Claude + GPT", fraction: 1, rejected: true },
    { modelID: "claude-sonnet-4-6", group: "Gemini models", fraction: 1, rejected: false },
  ])("reads the failed model's own group for $modelID", ({ modelID, group, fraction, rejected }) => {
    expect(
      GoogleAntigravityWire.explainCloudCodeError({
        error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." },
        summary: { groups: [{ displayName: group, buckets: [{ window: "5h", remainingFraction: fraction }] }] },
        httpStatus: 429,
        modelID,
      })?.rejected,
    ).toBe(rejected)
  })

  test.each([
    { name: "an explicit reason", error: { reason: "RATE_LIMIT_EXCEEDED" }, summary: fullQuota(1) },
    { name: "partly used quota", error: {}, summary: fullQuota(0.5) },
    { name: "no quota summary", error: {}, summary: undefined },
    { name: "a retry delay", error: { retryDelay: "30s" }, summary: fullQuota(1) },
    { name: "5h just under the threshold", error: {}, summary: fullQuota(0.9499) },
    {
      name: "an exhausted weekly window",
      error: {},
      summary: {
        groups: [
          {
            displayName: "Gemini models",
            buckets: [
              { window: "5h", remainingFraction: 1 },
              { window: "weekly", remainingFraction: 0 },
            ],
          },
        ],
      },
    },
  ])("keeps a bare throttle retryable with $name", ({ error, summary }) => {
    expect(
      GoogleAntigravityWire.explainCloudCodeError({
        error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota).", ...error },
        summary,
        httpStatus: 429,
        modelID: "gemini-3.8-flash-low",
      })?.rejected,
    ).toBe(false)
  })

  test("ignores success-shaped bodies", () => {
    expect(GoogleAntigravityWire.parseCloudCodeError('data: {"response":{"candidates":[]}}\n\n')).toBeUndefined()
  })
})
