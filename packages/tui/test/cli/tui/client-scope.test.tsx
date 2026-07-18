/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ClientProvider, useClient } from "../../../src/context/client"
import { createApi, createEventStream, createFetch, directory } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mount(interest: { location: { directory: string }; sessions?: string[] }) {
  const events = createEventStream()
  const eventUrls: URL[] = []
  const calls = createFetch((url, request) => {
    if (url.pathname !== "/api/event") return undefined
    eventUrls.push(url)
    return events.v2(request.signal)
  }, events)

  let client!: ReturnType<typeof useClient>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)} interest={interest}>
        <Probe
          onReady={(ctx) => {
            client = ctx
            done()
          }}
        />
      </ClientProvider>
    </TestTuiContexts>
  ))

  await ready
  return { app, client, eventUrls }
}

describe("ClientProvider event.scope", () => {
  test("connects the event stream with location interest", async () => {
    const { app, client, eventUrls } = await mount({ location: { directory } })
    try {
      await wait(() => client.connection.status() === "connected" && eventUrls.length >= 1)
      expect(eventUrls[0]?.searchParams.get("location[directory]")).toBe(directory)
      expect(eventUrls[0]?.searchParams.getAll("session")).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })

  test("reconnects when session interest changes", async () => {
    const { app, client, eventUrls } = await mount({ location: { directory } })
    try {
      await wait(() => client.connection.status() === "connected" && eventUrls.length >= 1)

      client.event.scope({ location: { directory }, sessions: ["ses_a"] })
      await wait(() => eventUrls.length >= 2)
      expect(eventUrls[1]?.searchParams.get("location[directory]")).toBe(directory)
      expect(eventUrls[1]?.searchParams.getAll("session")).toEqual(["ses_a"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not reconnect when interest is unchanged", async () => {
    const { app, client, eventUrls } = await mount({
      location: { directory },
      sessions: ["ses_a"],
    })
    try {
      await wait(() => client.connection.status() === "connected" && eventUrls.length >= 1)
      const before = eventUrls.length

      client.event.scope({ location: { directory }, sessions: ["ses_a"] })
      await Bun.sleep(50)
      expect(eventUrls.length).toBe(before)
    } finally {
      app.renderer.destroy()
    }
  })
})

function Probe(props: { onReady: (client: ReturnType<typeof useClient>) => void }) {
  const client = useClient()
  onMount(() => props.onReady(client))
  return <box />
}
