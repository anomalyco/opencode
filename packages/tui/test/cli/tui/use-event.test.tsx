/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import type { OpencodeClient, V2Event } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/context/project"
import { SDKProvider, useSDK } from "../../../src/context/sdk"
import { useEvent } from "../../../src/context/event"
import { createApi, createClient, createEventStream, createFetch } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

const projectID = "proj_test"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function event(payload: V2Event, input: { directory: string; project?: string; workspace?: string }): V2Event {
  return {
    ...payload,
    location: { directory: input.directory, workspaceID: input.workspace },
  }
}

function vcs(branch: string): V2Event {
  return {
    id: `evt_vcs_${branch}`,
    type: "vcs.branch.updated",
    data: {
      branch,
    },
  }
}

function update(version: string): V2Event {
  return {
    id: `evt_update_${version}`,
    type: "installation.update-available",
    data: {
      version,
    },
  }
}

async function mount(reload?: () => Promise<{ client: OpencodeClient; api: OpenCodeClient }>) {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const seen: V2Event[] = []
  const workspaces: Array<string | undefined> = []
  let project!: ReturnType<typeof useProject>
  let sdk!: ReturnType<typeof useSDK>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)} reload={reload}>
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
  return { app, emit: events.emit, project, sdk, seen, workspaces }
}

function Probe(props: {
  seen: V2Event[]
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

  test("reloads the host and reconnects the event stream", async () => {
    let calls = 0
    const events = createEventStream()
    const replacementCalls = createFetch(undefined, events)
    const replacement = { client: createClient(replacementCalls.fetch), api: createApi(replacementCalls.fetch) }
    const { app, sdk, seen } = await mount(async () => {
      calls += 1
      return replacement
    })

    try {
      await wait(() => sdk.connection.status() === "connected")
      await sdk.reload?.()
      await wait(() => sdk.connection.status() === "connected")
      events.emit(event(vcs("reloaded"), { directory: "/tmp/reloaded" }))
      await wait(() => seen.some((item) => item.type === "vcs.branch.updated" && item.data.branch === "reloaded"))

      expect(calls).toBe(1)
      expect(sdk.client).toBe(replacement.client)
      expect(sdk.api).toBe(replacement.api)
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps the current event stream alive while the host reload is pending", async () => {
    let complete!: (client: { client: OpencodeClient; api: OpenCodeClient }) => void
    const pending = new Promise<{ client: OpencodeClient; api: OpenCodeClient }>((resolve) => {
      complete = resolve
    })
    const replacementEvents = createEventStream()
    const replacementCalls = createFetch(undefined, replacementEvents)
    const replacement = { client: createClient(replacementCalls.fetch), api: createApi(replacementCalls.fetch) }
    const { app, emit, sdk, seen } = await mount(() => pending)

    try {
      await wait(() => sdk.connection.status() === "connected")
      const reload = sdk.reload?.()
      emit(event(vcs("during-reload"), { directory: "/tmp/reload" }))
      await wait(() => seen.some((item) => item.type === "vcs.branch.updated" && item.data.branch === "during-reload"))

      expect(sdk.connection.status()).toBe("connected")
      complete(replacement)
      await reload
      expect(sdk.client).toBe(replacement.client)
      expect(sdk.api).toBe(replacement.api)
    } finally {
      app.renderer.destroy()
    }
  })
})
