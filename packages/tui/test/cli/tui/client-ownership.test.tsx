/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ClientProvider, useClient } from "../../../src/context/client"
import { createApi, createEventStream, createFetch, directory } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function trackStreams(events: ReturnType<typeof createEventStream>) {
  let concurrent = 0
  let maxConcurrent = 0
  const calls = createFetch((url, request) => {
    if (url.pathname !== "/api/event") return undefined
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    const signal = request.signal
    const response = events.v2(signal)
    const onAbort = () => {
      concurrent = Math.max(0, concurrent - 1)
      signal.removeEventListener("abort", onAbort)
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener("abort", onAbort, { once: true })
    return response
  }, events)
  return {
    fetch: calls.fetch,
    get concurrent() {
      return concurrent
    },
    get maxConcurrent() {
      return maxConcurrent
    },
  }
}

async function mountClient(input: {
  fetch: typeof globalThis.fetch
  onReady?: (client: ReturnType<typeof useClient>) => void
}) {
  let client!: ReturnType<typeof useClient>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(input.fetch)} interest={{ location: { directory } }}>
        <Probe
          onReady={(ctx) => {
            client = ctx
            input.onReady?.(ctx)
            done()
          }}
        />
      </ClientProvider>
    </TestTuiContexts>
  ))

  await ready
  return { app, client }
}

async function mount(input?: { onReady?: (client: ReturnType<typeof useClient>) => void }) {
  const events = createEventStream()
  const { app, client } = await mountClient({
    fetch: createFetch((url, request) => {
      if (url.pathname !== "/api/event") return undefined
      return events.v2(request.signal)
    }, events).fetch,
    onReady: input?.onReady,
  })
  return { app, client, events }
}

async function mountTracked(input?: { onReady?: (client: ReturnType<typeof useClient>) => void }) {
  const events = createEventStream()
  const streams = trackStreams(events)
  const { app, client } = await mountClient({
    fetch: streams.fetch,
    onReady: input?.onReady,
  })
  return { app, client, events, streams }
}

function connected(client: ReturnType<typeof useClient>) {
  return () => client.connection.status() === "connected"
}

function connectedAlone(client: ReturnType<typeof useClient>, streams: { concurrent: number }) {
  return () => client.connection.status() === "connected" && streams.concurrent === 1
}

describe("ClientProvider stream ownership", () => {
  test("rapid interest changes never exceed one active event stream", async () => {
    const { app, client, streams } = await mountTracked()

    try {
      await wait(connectedAlone(client, streams))

      for (let i = 0; i < 8; i++) {
        client.event.scope({ location: { directory }, sessions: [`ses_${i}`] })
      }
      await wait(connectedAlone(client, streams))
      expect(streams.maxConcurrent).toBeLessThanOrEqual(2)
      expect(streams.concurrent).toBe(1)
      expect(client.connection.internal.generation()).toBeGreaterThanOrEqual(8)
    } finally {
      app.renderer.destroy()
    }
    await Bun.sleep(20)
    expect(streams.concurrent).toBe(0)
  })

  test("event IDs from a prior generation are not delivered after interest reconnect", async () => {
    const seen: Array<{ id: string; generation: number }> = []
    const { app, client, events } = await mount({
      onReady: (ctx) => {
        ctx.event.on("vcs.branch.updated", (event) => {
          seen.push({ id: event.id, generation: ctx.connection.internal.generation() })
        })
      },
    })

    try {
      await wait(connected(client))
      const generation = client.connection.internal.generation()
      events.emit(vcs("before"))
      await wait(() => seen.some((entry) => entry.id === "evt_vcs_before"))

      client.event.scope({ location: { directory }, sessions: ["ses_next"] })
      await wait(() => connected(client)() && client.connection.internal.generation() > generation)
      const next = client.connection.internal.generation()
      events.emit(vcs("after"))
      await wait(() => seen.some((entry) => entry.id === "evt_vcs_after"))

      expect(seen.filter((entry) => entry.id === "evt_vcs_before")).toEqual([{ id: "evt_vcs_before", generation }])
      expect(seen.filter((entry) => entry.id === "evt_vcs_after")).toEqual([{ id: "evt_vcs_after", generation: next }])
    } finally {
      app.renderer.destroy()
    }
  })

  test("teardown leaves zero active event streams", async () => {
    const { app, client, streams } = await mountTracked()

    await wait(connectedAlone(client, streams))
    app.renderer.destroy()
    await wait(() => streams.concurrent === 0)
    expect(streams.concurrent).toBe(0)
  })
})

function Probe(props: { onReady: (client: ReturnType<typeof useClient>) => void }) {
  const client = useClient()
  onMount(() => props.onReady(client))
  return <box />
}

function vcs(branch: string): OpenCodeEvent {
  return {
    id: `evt_vcs_${branch}`,
    created: 0,
    type: "vcs.branch.updated",
    data: { branch },
  }
}
