// Phase 7: provider 5xx. The HTTP executor retries a status failure twice by itself (500 ms base, ARCHITECTURE §10);
// what is left reaches the loop, which retries 3× with 2/4/8 s backoff (scaled ×0.001 by the harness) and emits a
// `status` retry event per attempt.
import { describe, expect, test } from "bun:test"
import { setup } from "../cli/harness"
import { reply } from "../lib/local-server"
import { events, spawn } from "./lib"

const retries = (stdout: string) => events(stdout).filter((event) => event.type === "status" && event.phase === "retry")

describe("provider 5xx", () => {
  test("5xx twice then success: absorbed by the executor, final answer, exit 0", async () => {
    await using env = await setup({ toggles: { fail_status: { code: 503, times: 2 } } })
    env.server.queue(reply.text("recovered"))
    const result = await spawn(env, ["-p", "hi", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    expect(events(result.stdout).at(-1)).toMatchObject({ type: "result", text: "recovered", exit_code: 0 })
    expect(env.server.chats().map((chat) => chat.status)).toEqual([503, 503, 200])
  }, 30_000)

  test("5xx past the executor's retries: loop retry events carry attempt and wait, then the answer", async () => {
    // 3 fails the first loop attempt (1 + 2 executor retries), 3 more fail loop retry 1; loop retry 2 succeeds.
    await using env = await setup({ toggles: { fail_status: { code: 503, times: 6 } } })
    env.server.queue(reply.text("recovered late"))
    const result = await spawn(env, ["-p", "hi", "--output-format", "stream-json"])
    expect(result.code).toBe(0)
    expect(retries(result.stdout).map((event) => [event.attempt, event.wait_ms])).toEqual([
      [1, 2],
      [2, 4],
    ])
    expect(String(retries(result.stdout)[0]?.message)).toContain("retrying")
    expect(events(result.stdout).at(-1)).toMatchObject({ type: "result", text: "recovered late", exit_code: 0 })
  }, 30_000)

  test("5xx on every attempt: 3 loop retries, then exit 1 with a clear error and no hang", async () => {
    await using env = await setup({ toggles: { fail_status: { code: 503, times: 1000 } } })
    const started = Date.now()
    const result = await spawn(env, ["-p", "hi", "--output-format", "stream-json"])
    expect(result.code).toBe(1)
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(retries(result.stdout).map((event) => event.attempt)).toEqual([1, 2, 3])
    const stream = events(result.stdout)
    expect(stream.find((event) => event.type === "error")).toMatchObject({ retryable: false })
    expect(String(stream.find((event) => event.type === "error")?.message)).toMatch(/503|unavailable|server/i)
    expect(stream.at(-1)).toMatchObject({ type: "result", state: "failed", exit_code: 1 })
    // 4 loop attempts × (1 + 2 executor retries).
    expect(env.server.chats()).toHaveLength(12)
    const text = await spawn(env, ["-p", "hi"])
    expect(text.code).toBe(1)
    expect(text.stdout).toBe("")
    expect(text.stderr).toMatch(/503|unavailable|server/i)
  }, 60_000)
})
