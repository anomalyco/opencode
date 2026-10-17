import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import {
  resolveRestartApproval,
  type RestartApprovalDecision,
  type RestartApprovalDeps,
} from "../src/commands/handlers/service/restart"

type StubState = {
  active: Record<string, { type: "running" }>
  activeCalls: number
  drainAfterActiveCalls?: number
  activeFails: boolean
  requests: number
  resolves: Array<string>
  resolveFirstFails: boolean
  winner: RestartApprovalDecision | undefined
  sseConnections: number
  order: Array<string>
}

function startStub(initial: Partial<StubState> = {}) {
  const state: StubState = {
    active: {},
    activeCalls: 0,
    activeFails: false,
    requests: 0,
    resolves: [],
    resolveFirstFails: false,
    winner: undefined,
    sseConnections: 0,
    order: [],
    ...initial,
  }
  const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: unknown) => {
    try {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      controllers.delete(controller)
    }
  }
  const broadcast = (event: unknown) => {
    for (const controller of [...controllers]) send(controller, event)
  }
  const resolve = (decision: RestartApprovalDecision) => {
    if (state.winner === undefined) {
      state.winner = decision
      broadcast({ id: "evt_resolved", type: "server.restart.resolved", created: 1, data: { decision } })
    }
    return { decision: state.winner }
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/api/session/active") {
        state.activeCalls += 1
        if (state.activeFails) return new Response("gone", { status: 500 })
        if (state.drainAfterActiveCalls !== undefined && state.activeCalls > state.drainAfterActiveCalls)
          state.active = {}
        return Response.json({ data: state.active })
      }
      if (request.method === "POST" && url.pathname === "/api/server/restart/request") {
        state.requests += 1
        state.order.push("request")
        return Response.json({ active: Object.keys(state.active) })
      }
      if (request.method === "POST" && url.pathname === "/api/server/restart/resolve") {
        const body = (await request.json()) as { decision: RestartApprovalDecision }
        state.resolves.push(body.decision)
        if (state.resolveFirstFails && state.resolves.length === 1) {
          return Response.json({ _tag: "InvalidRequestError", message: "No pending service restart request" }, { status: 400 })
        }
        return Response.json(resolve(body.decision))
      }
      if (request.method === "GET" && url.pathname === "/api/event") {
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            state.sseConnections += 1
            state.order.push("sse")
            controllers.add(controller)
            send(controller, { id: "evt_connected", type: "server.connected", created: 0, data: {} })
          },
          cancel: (controller) => {
            controllers.delete(controller)
          },
        })
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${server.port}`, headers: {} })
  return {
    state,
    client,
    url: `http://127.0.0.1:${server.port}`,
    broadcastExpired: () => broadcast({ id: "evt_expired", type: "server.restart.expired", created: 2, data: {} }),
    stop: () => server.stop(true),
  }
}

const deps = (overrides: Partial<RestartApprovalDeps> = {}): RestartApprovalDeps => ({
  force: false,
  interactive: false,
  ask: () => Effect.succeed<RestartApprovalDecision>("now"),
  resolveTimeoutMs: 5_000,
  idlePollMs: 10,
  onWaiting: () => {},
  ...overrides,
})

const run = (client: OpenCodeClient, input: RestartApprovalDeps) =>
  Effect.runPromise(resolveRestartApproval(client, input))

async function until(condition: () => boolean, message: string) {
  const deadline = Date.now() + 5_000
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message)
    await Bun.sleep(10)
  }
}

async function tuiResolve(url: string, decision: RestartApprovalDecision) {
  const response = await fetch(`${url}/api/server/restart/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  })
  if (!response.ok) throw new Error(`TUI resolve failed: ${response.status}`)
}

test("no active sessions restarts without requesting approval", async () => {
  const stub = startStub()
  try {
    expect(await run(stub.client, deps())).toBe("now")
    expect(stub.state.requests).toBe(0)
  } finally {
    await stub.stop()
  }
})

test("active sessions with --force restart without requesting approval", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    expect(await run(stub.client, deps({ force: true }))).toBe("now")
    expect(stub.state.requests).toBe(0)
    expect(stub.state.resolves).toEqual([])
  } finally {
    await stub.stop()
  }
})

test("the event subscription connects before the intent request", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const pending = run(stub.client, deps({ resolveTimeoutMs: 300 }))
    await pending.then(
      () => undefined,
      () => undefined,
    )
    expect(stub.state.order[0]).toBe("sse")
    expect(stub.state.order).toContain("request")
  } finally {
    await stub.stop()
  }
})

test("non-TTY waits for a TUI decision and obeys the winner", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const pending = run(stub.client, deps())
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    await tuiResolve(stub.url, "now")
    expect(await pending).toBe("now")
    expect(stub.state.requests).toBe(1)
    // The CLI never resolves itself off-terminal; the only resolve is the TUI's.
    expect(stub.state.resolves).toEqual(["now"])
  } finally {
    await stub.stop()
  }
})

test("non-TTY timeout aborts without naming --force and leaves release to the server", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const error = await run(stub.client, deps({ resolveTimeoutMs: 200 })).then(
      () => undefined,
      (cause: Error) => cause,
    )
    expect(error?.message).toContain("Timed out")
    expect(error?.message).not.toContain("--force")
    expect(stub.state.requests).toBe(1)
    // Release is the server's job; the CLI does not post a cancel of its own.
    expect(stub.state.resolves).toEqual([])
  } finally {
    await stub.stop()
  }
})

test("an expired request aborts the wait", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const pending = run(stub.client, deps())
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    stub.broadcastExpired()
    const error = await pending.then(
      () => undefined,
      (cause: Error) => cause,
    )
    expect(error?.message).toContain("Timed out")
    expect(error?.message).not.toContain("--force")
  } finally {
    await stub.stop()
  }
})

test("a TUI cancel aborts the restart without naming --force", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const pending = run(stub.client, deps())
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    await tuiResolve(stub.url, "cancel")
    const error = await pending.then(
      () => undefined,
      (cause: Error) => cause,
    )
    expect(error?.message).toContain("still running")
    expect(error?.message).not.toContain("--force")
  } finally {
    await stub.stop()
  }
})

test("an idle winner waits until sessions finish", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } }, drainAfterActiveCalls: 3 })
  try {
    const waited: Array<ReadonlyArray<string>> = []
    const pending = run(
      stub.client,
      deps({ onWaiting: (active) => waited.push(active) }),
    )
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    await tuiResolve(stub.url, "idle")
    expect(await pending).toBe("idle")
    expect(waited.length).toBeGreaterThan(0)
  } finally {
    await stub.stop()
  }
})

test("the idle wait excludes the requesting session itself", async () => {
  const previous = process.env.OPENCODE_SESSION_ID
  process.env.OPENCODE_SESSION_ID = "ses_1"
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const pending = run(stub.client, deps())
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    await tuiResolve(stub.url, "idle")
    expect(await pending).toBe("idle")
    // One check plus one drain poll; without exclusion this would never settle.
    expect(stub.state.activeCalls).toBeLessThanOrEqual(2)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_SESSION_ID
    else process.env.OPENCODE_SESSION_ID = previous
    await stub.stop()
  }
})

test("an idle wait aborts when the server connection drops", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    const pending = run(stub.client, deps())
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    await tuiResolve(stub.url, "idle")
    await until(() => stub.state.activeCalls > 1, "CLI did not poll for idle")
    stub.state.activeFails = true
    const error = await pending.then(
      () => undefined,
      (cause: Error) => cause,
    )
    expect(error?.message).toContain("Lost connection")
  } finally {
    await stub.stop()
  }
})

test("a TTY pick adopts the first-wins winner", async () => {
  const stub = startStub({ active: { ses_1: { type: "running" } } })
  try {
    // A TUI decides first; the later local pick loses and the winner stands.
    await tuiResolve(stub.url, "cancel")
    const error = await run(stub.client, deps({ interactive: true })).then(
      () => undefined,
      (cause: Error) => cause,
    )
    expect(error?.message).toContain("--force")
    expect(stub.state.resolves).toEqual(["cancel", "now"])
  } finally {
    await stub.stop()
  }
})

test("a lost resolve race falls back to the broadcast winner", async () => {
  const stub = startStub({
    active: { ses_1: { type: "running" } },
    drainAfterActiveCalls: 4,
    resolveFirstFails: true,
  })
  try {
    const pending = run(stub.client, deps({ interactive: true }))
    await until(() => stub.state.requests > 0, "CLI did not request approval")
    await tuiResolve(stub.url, "idle")
    expect(await pending).toBe("idle")
  } finally {
    await stub.stop()
  }
})
