/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client"
import type { Service } from "@opencode-ai/client/effect"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/context/project"
import { ClientProvider, useClient } from "../../../src/context/client"
import { useEvent } from "../../../src/context/event"
import { createApi, createEventStream, createFetch } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import type { LogLevel, LogSink } from "../../../src/context/log"

const projectID = "proj_test"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function event(
  payload: OpenCodeEvent,
  input: { directory: string; project?: string; workspace?: string },
): OpenCodeEvent {
  return {
    ...payload,
    location: { directory: input.directory, workspaceID: input.workspace },
  }
}

function vcs(branch: string): OpenCodeEvent {
  return {
    id: `evt_vcs_${branch}`,
    created: 0,
    type: "vcs.branch.updated",
    data: {
      branch,
    },
  }
}

function update(version: string): OpenCodeEvent {
  return {
    id: `evt_update_${version}`,
    created: 0,
    type: "installation.update-available",
    data: {
      version,
    },
  }
}

async function mount(
  reconnect?: (onStatus: (status: Service.Status) => void, signal: AbortSignal) => Promise<{ api: OpenCodeClient }>,
  log?: LogSink,
) {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const seen: OpenCodeEvent[] = []
  const workspaces: Array<string | undefined> = []
  let project!: ReturnType<typeof useProject>
  let client!: ReturnType<typeof useClient>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts log={log}>
      <ClientProvider api={createApi(calls.fetch)} reconnect={reconnect}>
        <ProjectProvider>
          <Probe
            onReady={async (ctx) => {
              project = ctx.project
              client = ctx.client
              await project.sync()
              done()
            }}
            seen={seen}
            workspaces={workspaces}
          />
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  await ready
  return { app, events, emit: events.emit, project, client, seen, workspaces }
}

function Probe(props: {
  seen: OpenCodeEvent[]
  workspaces: Array<string | undefined>
  onReady: (ctx: { project: ReturnType<typeof useProject>; client: ReturnType<typeof useClient> }) => void
}) {
  const project = useProject()
  const client = useClient()
  const event = useEvent()

  onMount(() => {
    event.subscribe((evt, { workspace }) => {
      props.seen.push(evt)
      props.workspaces.push(workspace)
    })
    props.onReady({ project, client })
  })

  return <box />
}

describe("useEvent", () => {
  test("logs only durable events", async () => {
    const logs: Array<{ level: LogLevel; message: string; tags: Readonly<Record<string, unknown>> }> = []
    const { app, emit, seen } = await mount(undefined, (level, message, tags) => {
      if (message === "event") logs.push({ level, message, tags })
    })
    const durable = event(
      {
        id: "evt_renamed",
        created: 1,
        type: "session.renamed",
        durable: { aggregateID: "ses_test", seq: 1, version: 1 },
        data: { sessionID: "ses_test", title: "Renamed" },
      },
      { directory: "/tmp/project" },
    )

    try {
      emit(vcs("main"))
      emit(durable)
      await wait(() => seen.length === 2 && logs.length === 1)

      expect(logs).toEqual([
        {
          level: "debug",
          message: "event",
          tags: { component: "client", type: "session.renamed", aggregateID: "ses_test", seq: 1 },
        },
      ])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers events for the current project", async () => {
    const { app, emit, seen, workspaces } = await mount()

    try {
      emit(event(vcs("main"), { directory: "/tmp/other", project: projectID, workspace: "ws_a" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([event(vcs("main"), { directory: "/tmp/other", workspace: "ws_a" })])
      expect(workspaces).toEqual(["ws_a"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers current project events regardless of active workspace", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(vcs("ws"), { directory: "/tmp/other", project: projectID, workspace: "ws_b" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([event(vcs("ws"), { directory: "/tmp/other", workspace: "ws_b" })])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers truly global events even when a workspace is active", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(update("1.2.3"), { directory: "global" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([event(update("1.2.3"), { directory: "global" })])
    } finally {
      app.renderer.destroy()
    }
  })

  test("reconnects to the server after the event stream drops", async () => {
    const attempts: number[] = []
    const replacementEvents = createEventStream()
    const replacementCalls = createFetch(undefined, replacementEvents)
    const replacement = { api: createApi(replacementCalls.fetch) }
    const { app, events, client, seen } = await mount(async () => {
      attempts.push(attempts.length + 1)
      return replacement
    })

    try {
      await wait(() => client.connection.status() === "connected")
      // Reconnection only runs when the stream is down, never while connected.
      expect(attempts).toEqual([])
      events.disconnect()
      await wait(() => client.connection.status() === "connected" && attempts.length > 0)
      replacementEvents.emit(event(vcs("rediscovered"), { directory: "/tmp/rediscovered" }))
      await wait(() => seen.some((item) => item.type === "vcs.branch.updated" && item.data.branch === "rediscovered"))

      expect(client.api).toBe(replacement.api)
      expect(attempts).toEqual([1])
      const history = client.connection.internal.history()
      expect(history.map((event) => [event.data.status, event.data.attempt])).toEqual([
        ["connecting", 0],
        ["connected", 0],
        ["disconnected", 1],
        ["reconnecting", 1],
        ["connected", 1],
      ])
      expect(history.every((event) => Number.isFinite(event.created))).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps the current client when reconnection fails", async () => {
    let calls = 0
    const { app, events, client, seen } = await mount(async () => {
      calls += 1
      throw new Error("no server")
    })

    try {
      await wait(() => client.connection.status() === "connected")
      const original = client.api
      events.disconnect()
      // Reconnection rejects; the loop retries against the last known transport,
      // which succeeds once the fixture accepts the reconnect.
      await wait(() => calls > 0 && client.connection.status() === "connected")
      events.emit(event(vcs("recovered"), { directory: "/tmp/recovered" }))
      await wait(() => seen.some((item) => item.type === "vcs.branch.updated" && item.data.branch === "recovered"))

      expect(client.api).toBe(original)
    } finally {
      app.renderer.destroy()
    }
  })

  test("backs off when a resolved event stream keeps failing", async () => {
    let calls = 0
    const encoder = new TextEncoder()
    const replacementCalls = createFetch((url) => {
      if (url.pathname !== "/api/event") return undefined
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"id":"evt_connected","type":"server.connected","data":{}}\n\n'),
            )
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    })
    const replacement = {
      api: createApi(replacementCalls.fetch),
    }
    const { app, events, client } = await mount(async () => {
      calls += 1
      return replacement
    })

    try {
      await wait(() => client.connection.status() === "connected")
      events.disconnect()
      await Promise.race([
        wait(() => calls === 2),
        Bun.sleep(500).then(() => {
          throw new Error("resolved event stream did not retry immediately")
        }),
      ])
      await Bun.sleep(200)
      expect(calls).toBe(2)
    } finally {
      app.renderer.destroy()
    }
  })

  test("reports service status while endpoint resolution is pending", async () => {
    const replacementEvents = createEventStream()
    const replacement = { api: createApi(createFetch(undefined, replacementEvents).fetch) }
    let report!: (status: Service.Status) => void
    let resolve!: (value: typeof replacement) => void
    const endpoint = new Promise<typeof replacement>((done) => {
      resolve = done
    })
    const { app, events, client } = await mount(async (onStatus) => {
      report = onStatus
      onStatus({ type: "starting", version: "2.0.0" })
      return endpoint
    })

    try {
      await wait(() => client.connection.status() === "connected")
      events.disconnect()
      await wait(
        () => client.connection.status() === "reconnecting" && client.connection.service()?.type === "starting",
      )
      expect(client.connection.service()).toEqual({ type: "starting", version: "2.0.0" })

      report({ type: "failed", message: "Could not open the database.", action: "Check the service logs." })
      await wait(() => client.connection.service()?.type === "failed")
      expect(client.connection.service()).toEqual({
        type: "failed",
        message: "Could not open the database.",
        action: "Check the service logs.",
      })

      resolve(replacement)
      await wait(() => client.connection.status() === "connected")
      expect(client.connection.service()).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("cancels pending endpoint resolution on cleanup", async () => {
    let aborted = false
    const { app, events, client } = await mount(
      (_onStatus, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true },
          )
        }),
    )

    await wait(() => client.connection.status() === "connected")
    events.disconnect()
    await wait(() => client.connection.status() === "reconnecting")
    app.renderer.destroy()
    await wait(() => aborted)
  })
})
