/** @jsxImportSource @opentui/solid */
import { afterAll, describe, expect, test } from "bun:test"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import type { LogLevel, LogSink } from "../../../src/context/log"
import { createApi, createFetch } from "../../fixture/tui-client"

const packageRoot = process.env.OPENCODE_TUI_ROOT
const contextModule = packageRoot
  ? await import(`${packageRoot}/src/context/client.tsx`)
  : await import("../../../src/context/client")
const environmentModule = packageRoot
  ? await import(`${packageRoot}/test/fixture/tui-environment.tsx`)
  : await import("../../fixture/tui-environment")
const { ClientProvider, useClient } = contextModule as typeof import("../../../src/context/client")
const { TestTuiContexts } = environmentModule as typeof import("../../fixture/tui-environment")

type Client = ReturnType<typeof useClient>
type Service = {
  reconnect: (signal: AbortSignal) => Promise<{ api: OpenCodeClient }>
  restart: () => Promise<void>
}
type Observation = {
  scenario: string
  value: unknown
}

const observations: Observation[] = []
const connected = { id: "evt_connected", type: "server.connected", data: {} } as OpenCodeEvent

afterAll(async () => {
  const output = process.env.CLIENT_BEHAVIOR_OUTPUT
  if (output) await Bun.write(output, `${JSON.stringify(observations, null, 2)}\n`)
})

function observe(scenario: string, value: unknown) {
  observations.push({ scenario, value })
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return `${error.name}:${error.message}`
  return String(error)
}

function history(client: Client) {
  return client.connection.internal.history().map((event) => ({
    status: event.data.status,
    attempt: event.data.attempt,
    error: event.data.error,
  }))
}

async function waitFor(check: () => boolean, timeout = 3_000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(5)
  }
}

function event(type: "vcs" | "update" | "rename", suffix: string): OpenCodeEvent {
  if (type === "vcs") {
    return {
      id: `evt_vcs_${suffix}`,
      created: 1,
      type: "vcs.branch.updated",
      location: { directory: "/tmp/project" },
      data: { branch: suffix },
    }
  }
  if (type === "update") {
    return {
      id: `evt_update_${suffix}`,
      created: 2,
      type: "installation.update-available",
      data: { version: suffix },
    }
  }
  return {
    id: `evt_rename_${suffix}`,
    created: 3,
    type: "session.renamed",
    durable: { aggregateID: "ses_test", seq: 1, version: 1 },
    location: { directory: "/tmp/project" },
    data: { sessionID: "ses_test", title: suffix },
  }
}

function createStream(options?: { first?: OpenCodeEvent; closeBeforeHandshake?: boolean }) {
  const encoder = new TextEncoder()
  const controllers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const requests: Request[] = []
  const aborts: string[] = []
  let cancellations = 0

  function response(request: Request) {
    requests.push(request)
    request.signal.addEventListener("abort", () => aborts.push(normalizeError(request.signal.reason)), { once: true })

    let current: ReadableStreamDefaultController<Uint8Array> | undefined
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          current = controller
          controllers.add(controller)
          if (options?.closeBeforeHandshake) {
            controllers.delete(controller)
            controller.close()
            return
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(options?.first ?? connected)}\n\n`))
        },
        cancel() {
          cancellations += 1
          if (current) controllers.delete(current)
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  }

  return {
    response,
    emit(value: OpenCodeEvent) {
      const chunk = encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
      for (const controller of controllers) controller.enqueue(chunk)
    },
    raw(value: string) {
      const chunk = encoder.encode(value)
      for (const controller of controllers) controller.enqueue(chunk)
    },
    close() {
      for (const controller of [...controllers]) {
        controllers.delete(controller)
        controller.close()
      }
    },
    fail(message: string) {
      for (const controller of [...controllers]) {
        controllers.delete(controller)
        controller.error(new Error(message))
      }
    },
    snapshot() {
      return {
        requests: requests.length,
        requestAborted: requests.map((request) => request.signal.aborted),
        aborts,
        cancellations,
        active: controllers.size,
      }
    },
  }
}

function apiFor(stream: ReturnType<typeof createStream>) {
  return createApi(
    createFetch((url, request) => {
      if (url.pathname === "/api/event") return stream.response(request)
    }).fetch,
  )
}

async function mount(input: {
  api: OpenCodeClient
  service?: Service
  throwOn?: OpenCodeEvent["type"]
}) {
  const seen: Array<{ type: string; status: string }> = []
  const typed: string[] = []
  const logs: Array<{ level: LogLevel; message: string; tags: Record<string, unknown> }> = []
  let initialStatus = ""
  let client!: Client
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })
  const log: LogSink = (level, message, tags) => {
    logs.push({ level, message, tags: { ...tags } })
  }

  const app = await testRender(() => (
    <TestTuiContexts log={log}>
      <ClientProvider api={input.api} service={input.service}>
        <Probe
          onReady={(value) => {
            client = value
            initialStatus = value.connection.status()
            ready()
          }}
          onEvent={(value) => {
            seen.push({ type: value.type, status: client.connection.status() })
            if (value.type === input.throwOn) throw new Error(`listener failed for ${value.type}`)
          }}
          onBranch={(branch) => typed.push(branch)}
        />
      </ClientProvider>
    </TestTuiContexts>
  ))
  await mounted

  return { app, client, initialStatus, seen, typed, logs }
}

function Probe(props: {
  onReady: (client: Client) => void
  onEvent: (event: OpenCodeEvent) => void
  onBranch: (branch: string) => void
}) {
  const client = useClient()
  onMount(() => {
    client.event.listen(({ details }) => props.onEvent(details))
    client.event.on("vcs.branch.updated", (value) => props.onBranch(value.data.branch ?? ""))
    props.onReady(client)
  })
  return <box />
}

describe("ClientProvider connection characterization", () => {
  test("records handshake ordering, event delivery, logging, and active-stream cleanup", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.emit(event("vcs", "main"))
    stream.emit(event("rename", "renamed"))
    stream.emit(event("update", "2.0.0"))
    await waitFor(() => setup.seen.length === 4)

    observe("healthy.connected", {
      initialStatus: setup.initialStatus,
      finalStatus: setup.client.connection.status(),
      seen: setup.seen,
      typed: setup.typed,
      logs: setup.logs,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    await waitFor(() => stream.snapshot().requestAborted[0] === true)
    await Bun.sleep(20)

    observe("healthy.cleanup", {
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    expect(setup.seen.map((item) => item.type)).toEqual([
      "server.connected",
      "vcs.branch.updated",
      "session.renamed",
      "installation.update-available",
    ])
    expect(setup.seen.map((item) => item.status)).toEqual(["connecting", "connected", "connected", "connected"])
    expect(setup.logs.filter((item) => item.message === "event")).toHaveLength(1)
  })

  test("records an invalid first event", async () => {
    const stream = createStream({ first: event("vcs", "invalid-handshake") })
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "reconnecting")
    observe("handshake.invalid", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("Event stream did not start with server.connected")
  })

  test("records EOF before the handshake", async () => {
    const stream = createStream({ closeBeforeHandshake: true })
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "reconnecting")
    observe("handshake.eof", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("Event stream disconnected")
  })

  test("records a fetch failure before the handshake", async () => {
    const calls = createFetch((url) => {
      if (url.pathname === "/api/event") throw new Error("network unavailable")
      return undefined
    })
    const setup = await mount({ api: createApi(calls.fetch) })

    await waitFor(() => setup.client.connection.status() === "reconnecting")
    observe("handshake.fetch-error", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      history: history(setup.client),
      logs: setup.logs,
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("Transport")
  })

  test("records the initial connection timeout and request cancellation", async () => {
    const requests: Request[] = []
    const calls = createFetch((url, request) => {
      if (url.pathname !== "/api/event") return
      requests.push(request)
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true })
      })
    })
    const setup = await mount({ api: createApi(calls.fetch) })

    await waitFor(() => setup.client.connection.status() === "reconnecting", 3_000)
    observe("handshake.timeout", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      requestCount: requests.length,
      requestAborted: requests.map((request) => request.signal.aborted),
      abortReasons: requests.map((request) => normalizeError(request.signal.reason)),
      history: history(setup.client),
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("Transport")
  })

  test("records static transport reconnection after a connected stream closes", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.close()
    await waitFor(() => stream.snapshot().requests === 2, 2_000)
    await waitFor(() => setup.client.connection.status() === "connected")

    observe("reconnect.static", {
      status: setup.client.connection.status(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
      logs: setup.logs.filter((item) => item.message !== "event"),
    })

    setup.app.renderer.destroy()
    expect(setup.seen.map((item) => item.type)).toEqual(["server.connected", "server.connected"])
  })

  test("records immediate managed-service replacement", async () => {
    const initial = createStream()
    const replacement = createStream()
    const replacementApi = apiFor(replacement)
    const reconnectSignals: boolean[] = []
    const service: Service = {
      reconnect(signal) {
        reconnectSignals.push(signal.aborted)
        return Promise.resolve({ api: replacementApi })
      },
      restart: () => Promise.resolve(),
    }
    const setup = await mount({ api: apiFor(initial), service })

    await waitFor(() => setup.client.connection.status() === "connected")
    initial.close()
    await waitFor(() => replacement.snapshot().requests === 1)
    await waitFor(() => setup.client.connection.status() === "connected")
    replacement.emit(event("vcs", "replacement"))
    await waitFor(() => setup.typed.includes("replacement"))

    observe("reconnect.managed-replacement", {
      status: setup.client.connection.status(),
      apiReplaced: setup.client.api === replacementApi,
      reconnectSignals,
      seen: setup.seen,
      typed: setup.typed,
      history: history(setup.client),
      initial: initial.snapshot(),
      replacement: replacement.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(setup.client.api).toBe(replacementApi)
  })

  test("records managed-service resolution failure and delayed retry", async () => {
    const stream = createStream()
    let reconnects = 0
    const service: Service = {
      reconnect() {
        reconnects += 1
        return Promise.reject(new Error("service unavailable"))
      },
      restart: () => Promise.resolve(),
    }
    const setup = await mount({ api: apiFor(stream), service })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.close()
    await waitFor(() => stream.snapshot().requests === 2, 2_000)
    await waitFor(() => setup.client.connection.status() === "connected")

    observe("reconnect.managed-failure", {
      reconnects,
      status: setup.client.connection.status(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
      resolutionLogs: setup.logs.filter((item) => item.message === "server resolution failed"),
    })

    setup.app.renderer.destroy()
    expect(reconnects).toBe(1)
  })

  test("records cleanup while the initial fetch is pending", async () => {
    const requests: Request[] = []
    const aborts: string[] = []
    const calls = createFetch((url, request) => {
      if (url.pathname !== "/api/event") return
      requests.push(request)
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener(
          "abort",
          () => {
            aborts.push(normalizeError(request.signal.reason))
            reject(request.signal.reason)
          },
          { once: true },
        )
      })
    })
    const setup = await mount({ api: createApi(calls.fetch) })

    await waitFor(() => requests.length === 1)
    setup.app.renderer.destroy()
    await waitFor(() => requests[0].signal.aborted)
    await Bun.sleep(20)

    observe("cleanup.pending-handshake", {
      status: setup.client.connection.status(),
      requestAborted: requests[0].signal.aborted,
      aborts,
      history: history(setup.client),
      logs: setup.logs,
    })

    expect(history(setup.client).map((item) => item.status)).toEqual(["connecting"])
  })

  test("records an event listener failure as a connection failure", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream), throwOn: "vcs.branch.updated" })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.emit(event("vcs", "throws"))
    await waitFor(() => setup.client.connection.status() === "reconnecting")

    observe("listener.failure", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      typed: setup.typed,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("listener failed for vcs.branch.updated")
  })

  test("records stream reader failure after connection", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.fail("reader exploded")
    await waitFor(() => setup.client.connection.status() === "reconnecting")

    observe("stream.reader-failure", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("Transport")
  })

  test("records malformed SSE data after connection", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.raw("data: not-json\n\n")
    await waitFor(() => setup.client.connection.status() === "reconnecting")

    observe("stream.malformed-data", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(setup.client.connection.error()).toBe("MalformedResponse")
  })

  test("records a server.connected listener failure before connected state publication", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream), throwOn: "server.connected" })

    await waitFor(() => setup.client.connection.status() === "reconnecting")
    observe("listener.connected-failure", {
      status: setup.client.connection.status(),
      error: setup.client.connection.error(),
      seen: setup.seen,
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    setup.app.renderer.destroy()
    expect(history(setup.client).map((item) => item.status)).toEqual(["connecting", "connected", "disconnected"])
  })

  test("records cleanup during static reconnect backoff", async () => {
    const stream = createStream()
    const setup = await mount({ api: apiFor(stream) })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.close()
    await waitFor(() => setup.client.connection.status() === "reconnecting")
    setup.app.renderer.destroy()
    await Bun.sleep(1_050)

    observe("cleanup.reconnect-backoff", {
      status: setup.client.connection.status(),
      history: history(setup.client),
      stream: stream.snapshot(),
    })

    expect(stream.snapshot().requests).toBe(1)
  })

  test("records cleanup during managed-service resolution", async () => {
    const stream = createStream()
    let resolutionStarted = false
    let resolutionAborted = false
    const service: Service = {
      reconnect(signal) {
        resolutionStarted = true
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              resolutionAborted = true
              reject(signal.reason)
            },
            { once: true },
          )
        })
      },
      restart: () => Promise.resolve(),
    }
    const setup = await mount({ api: apiFor(stream), service })

    await waitFor(() => setup.client.connection.status() === "connected")
    stream.close()
    await waitFor(() => resolutionStarted)
    setup.app.renderer.destroy()
    await waitFor(() => resolutionAborted)
    await Bun.sleep(20)

    observe("cleanup.service-resolution", {
      resolutionStarted,
      resolutionAborted,
      status: setup.client.connection.status(),
      history: history(setup.client),
      stream: stream.snapshot(),
      logs: setup.logs,
    })

    expect(resolutionAborted).toBe(true)
  })

  test("records attempt reset after a stable connection", async () => {
    const streams = [createStream(), createStream(), createStream()]
    const apis = streams.map(apiFor)
    let reconnects = 0
    const service: Service = {
      reconnect() {
        const api = apis[Math.min(reconnects + 1, apis.length - 1)]
        reconnects += 1
        return Promise.resolve({ api })
      },
      restart: () => Promise.resolve(),
    }
    const setup = await mount({ api: apis[0], service })

    await waitFor(() => setup.client.connection.status() === "connected")
    streams[0].close()
    await waitFor(() => streams[1].snapshot().requests === 1)
    streams[1].close()
    await waitFor(() => streams[2].snapshot().requests === 1)
    await Bun.sleep(1_050)
    streams[2].close()
    await waitFor(() => reconnects === 3)

    observe("reconnect.stable-reset", {
      reconnects,
      status: setup.client.connection.status(),
      history: history(setup.client),
      streams: streams.map((stream) => stream.snapshot()),
    })

    setup.app.renderer.destroy()
    expect(history(setup.client).filter((item) => item.status === "disconnected").map((item) => item.attempt)).toEqual([
      1, 2, 1,
    ])
  })
})
