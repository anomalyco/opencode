import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { shouldRelaxTlsForLocal, usageRequestBody, withLocalTls } from "@opencode-ai/core/bitcost/client"

describe("BitcostClient usage request body", () => {
  const report = {
    taskID: "task-1",
    idempotencyKey: "msg-1",
    requestID: "usage:task-1:msg-1",
    session: "ses-1",
    provider: "anthropic",
    model: "claude-x",
    variant: "thinking",
    cost: 0.0042,
    tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
  }

  test("includes the CLI-computed turn cost", () => {
    expect(usageRequestBody(report).cost).toBe(0.0042)
  })

  test("carries the model identity, session and idempotency key", () => {
    const body = usageRequestBody(report)
    expect(body).toMatchObject({
      idempotency_key: "msg-1",
      request_id: "usage:task-1:msg-1",
      session: "ses-1",
      provider: "anthropic",
      model: "claude-x",
      variant: "thinking",
      tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
    })
  })
})

describe("BitcostClient local TLS detection", () => {
  test("matches local bitcost hosts that use self-signed certs", () => {
    expect(shouldRelaxTlsForLocal("https://bitcost.test")).toBe(true)
    expect(shouldRelaxTlsForLocal("https://localhost:8443")).toBe(true)
    expect(shouldRelaxTlsForLocal("https://127.0.0.1:8443")).toBe(true)
    expect(shouldRelaxTlsForLocal("https://app.bitcost.dev")).toBe(false)
    expect(shouldRelaxTlsForLocal("not-a-url")).toBe(false)
  })

  test("restores NODE_TLS_REJECT_UNAUTHORIZED after local requests", async () => {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1"

    try {
      const inside = await Effect.runPromise(
        withLocalTls(
          "https://bitcost.test/api/tasks/1/usage",
          Effect.sync(() => process.env.NODE_TLS_REJECT_UNAUTHORIZED),
        ),
      )
      expect(inside).toBe("0")
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("1")
    } finally {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
    }
  })
})
