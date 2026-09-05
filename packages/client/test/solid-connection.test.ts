import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { OpenCode } from "../src/promise"
import { createClientConnection, reconnectBackoffDelay } from "../src/solid/connection.js"

const unauthorizedApi = OpenCode.make({
  baseUrl: "http://opencode.local",
  fetch: Object.assign(
    async () => new Response(null, { status: 401, headers: { "www-authenticate": 'Basic realm="Secure Area"' } }),
    { preconnect: async () => {} },
  ),
})

describe("reconnectBackoffDelay", () => {
  test("scales with the attempt count and caps at the maximum", () => {
    expect(reconnectBackoffDelay(1, 1_000)).toBe(1_000)
    expect(reconnectBackoffDelay(2, 1_000)).toBe(2_000)
    expect(reconnectBackoffDelay(5, 1_000)).toBe(5_000)
    expect(reconnectBackoffDelay(100, 1_000)).toBe(30_000)
    expect(reconnectBackoffDelay(0, 1_000)).toBe(1_000)
  })
})

test("backs off instead of retrying every second while the stream is unauthorized", async () => {
  let dispose!: () => void
  const connection = createRoot((d) => {
    dispose = d
    return createClientConnection(unauthorizedApi, {
      reconnectDelayMs: 20,
      onEvent: () => {},
    })
  })

  connection.start()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const history = connection.internal.history().filter((event) => event.data.status === "disconnected")
  dispose()

  expect(history.length).toBeGreaterThanOrEqual(3)
  const attempts = history.map((event) => event.data.attempt)
  const sorted = attempts.slice().sort((a, b) => a - b)
  expect(attempts).toEqual(sorted)
  expect(sorted.at(-1)).toBeGreaterThan(2)

  const gaps: number[] = []
  for (let index = 1; index < history.length; index++) {
    gaps.push(history[index].created - history[index - 1].created)
  }
  expect(gaps.at(-1)).toBeGreaterThan(gaps[0] ?? 0)
})
