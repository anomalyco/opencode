import { describe, expect, test } from "bun:test"
import { createRequestQueue } from "./request-queue"

function setup(input?: {
  limit?: number
  slowLimit?: number
  stallMs?: number
  headersTimeoutMs?: number
  setupHeadersTimeoutMs?: number
}) {
  const pending: Array<{ url: string; signal: AbortSignal; resolve: () => void }> = []
  const logs: Array<{ message: string; data: Record<string, unknown> }> = []
  let clock = 0

  const queue = createRequestQueue({
    limit: input?.limit ?? 2,
    slowLimit: input?.slowLimit,
    stallMs: input?.stallMs,
    headersTimeoutMs: input?.headersTimeoutMs,
    setupHeadersTimeoutMs: input?.setupHeadersTimeoutMs,
    now: () => clock,
    log: (message, data) => logs.push({ message, data }),
    fetch: Object.assign(
      (resource: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const request = new Request(resource, init)
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true })
          pending.push({ url: request.url, signal: request.signal, resolve: () => resolve(new Response("ok")) })
        }),
      { preconnect() {} },
    ),
  })

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  return { queue, pending, logs, settle, tick: (ms: number) => (clock += ms) }
}

describe("createRequestQueue", () => {
  test("starts a free slot before the caller continues its synchronous work", async () => {
    const input = setup()
    const response = input.queue.fetch("http://server/api/session")
    expect(input.pending.map((item) => new URL(item.url).pathname)).toEqual(["/api/session"])
    expect(input.queue.inflight()).toBe(1)
    input.pending[0]!.resolve()
    await response
    expect(input.queue.inflight()).toBe(0)
  })

  test("releases a free slot without sending an already-aborted request", async () => {
    const input = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(input.queue.fetch("http://server/api/session", { signal: controller.signal })).rejects.toBeInstanceOf(
      DOMException,
    )
    expect(input.pending).toHaveLength(0)
    expect(input.queue.inflight()).toBe(0)
  })

  test("caps concurrent requests and starts queued ones as slots free up", async () => {
    const input = setup()
    const responses = ["/api/a", "/api/b", "/api/c"].map((path) => input.queue.fetch(`http://server${path}`))
    await input.settle()
    expect(input.pending.map((item) => new URL(item.url).pathname)).toEqual(["/api/a", "/api/b"])
    expect(input.queue.queued()).toBe(1)
    input.pending[0]!.resolve()
    await input.settle()
    expect(input.pending.map((item) => new URL(item.url).pathname)).toEqual(["/api/a", "/api/b", "/api/c"])
    input.pending.forEach((item) => item.resolve())
    await Promise.all(responses)
    expect(input.queue.inflight()).toBe(0)
  })

  test("slow endpoints hold at most their share of slots so small reads go first", async () => {
    const input = setup({ limit: 4, slowLimit: 2 })

    const paths = [
      "/api/vcs?location[directory]=%2Fa",
      "/api/vcs/diff?location[directory]=%2Fa",
      "/api/worktree",
      "/api/session/ses_1",
      "/api/vcsx",
    ]

    const responses = paths.map((path) => input.queue.fetch(`http://server${path}`))
    await input.settle()
    const started = () => input.pending.map((item) => new URL(item.url).pathname)
    // Two slow requests fill the slow share; the worktree read waits while the fast reads jump ahead.
    expect(started()).toEqual(["/api/vcs", "/api/vcs/diff", "/api/session/ses_1", "/api/vcsx"])
    expect(input.queue.inflight()).toBe(4)
    expect(input.queue.queued()).toBe(1)
    // A fast request finishing does not free a slow slot.
    input.pending[2]!.resolve()
    await input.settle()
    expect(started()).toEqual(["/api/vcs", "/api/vcs/diff", "/api/session/ses_1", "/api/vcsx"])
    input.pending[0]!.resolve()
    await input.settle()
    expect(started()).toEqual(["/api/vcs", "/api/vcs/diff", "/api/session/ses_1", "/api/vcsx", "/api/worktree"])
    input.pending.forEach((item) => item.resolve())
    await Promise.all(responses)
    expect(input.queue.inflight()).toBe(0)
  })

  test("MCP discovery cannot occupy every slot ahead of chat reads", async () => {
    for (const path of ["/api/command", "/api/mcp", "/api/mcp/resource"]) {
      const input = setup({ limit: 4, slowLimit: 2 })
      const discovery = Array.from({ length: 4 }, (_, index) =>
        input.queue.fetch(`http://server${path}?location[directory]=%2Fproject-${index}`),
      )
      const chat = input.queue.fetch("http://server/api/session/ses_1/message")
      try {
        expect(input.pending.map((item) => new URL(item.url).pathname)).toEqual([
          path,
          path,
          "/api/session/ses_1/message",
        ])
        expect(input.queue.inflight()).toBe(3)
        expect(input.queue.queued()).toBe(2)
      } finally {
        input.pending.forEach((item) => item.resolve())
        await input.settle()
        input.pending.forEach((item) => item.resolve())
        await Promise.all([...discovery, chat])
      }
      expect(input.queue.inflight()).toBe(0)
      expect(input.queue.queued()).toBe(0)
    }
  })

  test("never counts the event stream against the budget", async () => {
    const input = setup({ limit: 1 })
    void input.queue.fetch("http://server/api/session")
    void input.queue.fetch("http://server/api/event")
    await input.settle()
    expect(input.pending.map((item) => new URL(item.url).pathname).toSorted()).toEqual(["/api/event", "/api/session"])
    expect(input.queue.inflight()).toBe(1)
  })

  test("aborted requests leave the queue without being sent", async () => {
    const input = setup({ limit: 1 })
    const controller = new AbortController()
    void input.queue.fetch("http://server/api/first")
    const aborted = input.queue.fetch("http://server/api/second", { signal: controller.signal })
    controller.abort()
    await input.settle()
    input.pending[0]!.resolve()
    await expect(aborted).rejects.toBeInstanceOf(DOMException)
    expect(input.pending.map((item) => new URL(item.url).pathname)).toEqual(["/api/first"])
    expect(input.queue.inflight()).toBe(0)
  })

  test("a request the server never answers times out and frees its slot", async () => {
    const input = setup({ limit: 1, headersTimeoutMs: 10 })
    const dead = input.queue.fetch("http://server/api/dead")
    const next = input.queue.fetch("http://server/api/next")
    expect(input.queue.queued()).toBe(1)
    const error = await dead.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe("TimeoutError")
    expect(input.pending.map((item) => new URL(item.url).pathname)).toEqual(["/api/dead", "/api/next"])
    input.pending[1]!.resolve()
    await expect(next).resolves.toBeInstanceOf(Response)
    expect(input.queue.inflight()).toBe(0)
  })

  test("worktree creation gets the setup deadline while other worktree requests keep the normal one", async () => {
    const input = setup({ limit: 4, slowLimit: 4, headersTimeoutMs: 10, setupHeadersTimeoutMs: 200 })
    const create = input.queue.fetch("http://server/api/worktree?location[directory]=%2Fa", { method: "POST" })

    const others = [
      input.queue.fetch("http://server/api/worktree?location[directory]=%2Fa"),
      input.queue.fetch("http://server/api/worktree/refresh?location[directory]=%2Fa", { method: "POST" }),
      input.queue.fetch("http://server/api/worktree?location[directory]=%2Fa", { method: "DELETE" }),
    ]

    const errors = await Promise.all(others.map((request) => request.catch((cause: unknown) => cause)))
    expect(errors.map((error) => (error as DOMException).name)).toEqual([
      "TimeoutError",
      "TimeoutError",
      "TimeoutError",
    ])
    // Past the normal deadline, the create is still on the wire.
    expect(input.pending[0]!.signal.aborted).toBe(false)
    input.pending[0]!.resolve()
    await expect(create).resolves.toBeInstanceOf(Response)
    expect(input.queue.inflight()).toBe(0)
  })

  test("caller aborts still reach the underlying request", async () => {
    const input = setup({ limit: 1 })
    const controller = new AbortController()
    const request = input.queue.fetch("http://server/api/slow", { signal: controller.signal })
    await input.settle()
    expect(input.pending[0]!.signal.aborted).toBe(false)
    controller.abort()
    expect(input.pending[0]!.signal.aborted).toBe(true)
    await expect(request).rejects.toBeInstanceOf(DOMException)
    expect(input.queue.inflight()).toBe(0)
  })

  test("a burst that drains promptly is not thrashing", async () => {
    const input = setup({ stallMs: 5 })
    const responses = Array.from({ length: 12 }, (_, index) => input.queue.fetch(`http://server/api/${index}`))
    await input.settle()
    expect(input.queue.queued()).toBe(10)

    // Drain two at a time before the stall threshold elapses.
    for (let round = 0; round < 6; round++) {
      input.pending.splice(0).forEach((item) => item.resolve())
      await input.settle()
    }

    await Promise.all(responses)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(input.logs).toEqual([])
  })

  test("logs what is in flight and queued once per burst after requests stall", async () => {
    const input = setup({ stallMs: 5 })
    input.queue.fetch("http://server/api/worktree?location[directory]=%2Fa").catch(() => undefined)
    input.tick(50)
    input.queue.fetch("http://server/api/worktree?location[directory]=%2Fb").catch(() => undefined)
    input.tick(50)
    input.queue.fetch("http://server/api/worktree?location[directory]=%2Fc").catch(() => undefined)
    input.tick(100)
    input.queue.fetch("http://server/api/info").catch(() => undefined)
    expect(input.logs).toEqual([])
    input.tick(2_000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(input.logs).toEqual([
      {
        message: "server thrashing detected",
        data: {
          limit: 2,
          inflight: [
            { method: "GET", url: "http://server/api/worktree?location[directory]=%2Fa", ms: 2_200 },
            { method: "GET", url: "http://server/api/worktree?location[directory]=%2Fb", ms: 2_150 },
          ],
          queued: [
            { method: "GET", url: "http://server/api/worktree?location[directory]=%2Fc", ms: 2_100 },
            { method: "GET", url: "http://server/api/info", ms: 2_000 },
          ],
        },
      },
    ])
    // Still stalled within the rate limit: no repeat.
    input.tick(2_000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(input.logs).toHaveLength(1)
    input.tick(10_000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(input.logs).toHaveLength(2)
  })
})
