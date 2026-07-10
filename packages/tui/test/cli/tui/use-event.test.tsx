/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { OpenCodeClient, OpenCodeEvent } from "@opencode-ai/client/promise"
import { testRender } from "@opentui/solid"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/context/project"
import { SDKProvider, useSDK } from "../../../src/context/sdk"
import { useEvent } from "../../../src/context/event"
import { createApi, createClient, createEventStream, createFetch } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"
import type { LogSink } from "../../../src/context/log"

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
  reconnect?: (attempt: number) => Promise<{ client: OpencodeClient; api: OpenCodeClient }>,
  log?: LogSink,
) {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const seen: OpenCodeEvent[] = []
  const workspaces: Array<string | undefined> = []
  let project!: ReturnType<typeof useProject>
  let sdk!: ReturnType<typeof useSDK>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts log={log}>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)} reconnect={reconnect}>
        <ProjectProvider>
          <Probe
            onReady={async (ctx) => {
              project = ctx.project
              sdk = ctx.sdk
              await project.sync()
              done()
            }}
            seen={seen}
            workspaces={workspaces}
          />
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  await ready
  return { app, events, emit: events.emit, project, sdk, seen, workspaces }
}

function Probe(props: {
  seen: OpenCodeEvent[]
  workspaces: Array<string | undefined>
  onReady: (ctx: { project: ReturnType<typeof useProject>; sdk: ReturnType<typeof useSDK> }) => void
}) {
  const project = useProject()
  const sdk = useSDK()
  const event = useEvent()

  onMount(() => {
    event.subscribe((evt, { workspace }) => {
      props.seen.push(evt)
      props.workspaces.push(workspace)
    })
    props.onReady({ project, sdk })
  })

  return <box />
}

describe("useEvent", () => {
  test("logs only durable events", async () => {
    const logs: Array<{ message: string; tags: Readonly<Record<string, unknown>> }> = []
    const { app, emit, seen } = await mount(undefined, (_level, message, tags) => {
      if (message === "event") logs.push({ message, tags })
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
          message: "event",
          tags: { component: "sdk", type: "session.renamed", aggregateID: "ses_test", seq: 1 },
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
    const replacement = { client: createClient(replacementCalls.fetch), api: createApi(replacementCalls.fetch) }
    const { app, events, sdk, seen } = await mount(async (attempt) => {
      attempts.push(attempt)
      return replacement
    })

    try {
      await wait(() => sdk.connection.status() === "connected")
      // Reconnection only runs when the stream is down, never while connected.
      expect(attempts).toEqual([])
      events.disconnect()
      await wait(() => sdk.connection.status() === "connected" && attempts.length > 0)
      replacementEvents.emit(event(vcs("rediscovered"), { directory: "/tmp/rediscovered" }))
      await wait(() => seen.some((item) => item.type === "vcs.branch.updated" && item.data.branch === "rediscovered"))

      expect(sdk.client).toBe(replacement.client)
      expect(sdk.api).toBe(replacement.api)
      expect(attempts).toEqual([1])
      const history = sdk.connection.internal.history()
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
    const { app, events, sdk, seen } = await mount(async () => {
      calls += 1
      throw new Error("no server")
    })

    try {
      await wait(() => sdk.connection.status() === "connected")
      const original = sdk.client
      events.disconnect()
      // Reconnection rejects; the loop retries against the last known transport,
      // which succeeds once the fixture accepts the reconnect.
      await wait(() => calls > 0 && sdk.connection.status() === "connected")
      events.emit(event(vcs("recovered"), { directory: "/tmp/recovered" }))
      await wait(() => seen.some((item) => item.type === "vcs.branch.updated" && item.data.branch === "recovered"))

      expect(sdk.client).toBe(original)
    } finally {
      app.renderer.destroy()
    }
  })
})
