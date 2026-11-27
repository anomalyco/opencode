import { expect, jest, test } from "bun:test"
import { ClientError } from "@opencode/client"
import { retrySessionSync } from "../../src/util/session-sync"

// Wait for the backoff timer instead of assuming a fixed number of microtasks
// inside retry(); cancellation and backoff details are covered in packages/util.
async function waitForBackoff() {
  for (let i = 0; i < 100; i++) {
    if (jest.getTimerCount() > 0) return
    await Promise.resolve()
  }
  throw new Error("retry backoff timer was never scheduled")
}

test.each([408, 429, 500, 502, 503, 504])("retries HTTP %s before recovering", async (status) => {
  jest.useFakeTimers()
  const controller = new AbortController()
  let calls = 0
  try {
    const task = retrySessionSync(async () => {
      if (++calls === 1) throw new ClientError("UnexpectedStatus", { cause: { status } })
    }, controller.signal)
    await waitForBackoff()
    jest.advanceTimersByTime(500)
    await task
    expect(calls).toBe(2)
  } finally {
    controller.abort()
    jest.useRealTimers()
  }
})

test.each([
  new ClientError("UnexpectedStatus", { cause: { status: 401 } }),
  new ClientError("UnexpectedStatus", { cause: { status: 403 } }),
  new ClientError("UnexpectedStatus", { cause: { status: 404 } }),
  new ClientError("UnexpectedStatus", { cause: { status: 422 } }),
  new ClientError("MalformedResponse"),
  new ClientError("Transport", { cause: new Error("invalid request") }),
  { _tag: "SessionNotFoundError", sessionID: "ses_missing", message: "Session not found" },
  new Error("editor failed"),
])("does not retry a terminal or unrelated failure (%s)", async (error) => {
  let calls = 0
  await expect(
    retrySessionSync(async () => {
      calls++
      throw error
    }, new AbortController().signal),
  ).rejects.toBe(error)
  expect(calls).toBe(1)
})

test.each([
  new ClientError("Transport", { cause: new TypeError("Failed to fetch") }),
  { _tag: "UnknownError", message: "Unexpected server error", ref: "err_test" },
])("retries a client transport or server failure (%s)", async (error) => {
  jest.useFakeTimers()
  const controller = new AbortController()
  let calls = 0
  try {
    const task = retrySessionSync(async () => {
      if (++calls === 1) throw error
    }, controller.signal)
    await waitForBackoff()
    jest.advanceTimersByTime(500)
    await task
    expect(calls).toBe(2)
  } finally {
    controller.abort()
    jest.useRealTimers()
  }
})
