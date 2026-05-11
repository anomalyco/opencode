/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/cli/cmd/tui/context/project"
import { SDKProvider } from "../../../src/cli/cmd/tui/context/sdk"
import { useEvent } from "../../../src/cli/cmd/tui/context/event"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function event(payload: Event, input: { directory: string; workspace?: string }): GlobalEvent {
  return {
    directory: input.directory,
    workspace: input.workspace,
    payload,
  }
}

function vcs(branch: string): Event {
  return {
    id: `evt_vcs_${branch}`,
    type: "vcs.branch.updated",
    properties: {
      branch,
    },
  }
}

function update(version: string): Event {
  return {
    id: `evt_update_${version}`,
    type: "installation.update-available",
    properties: {
      version,
    },
  }
}

function createSource() {
  let fn: ((event: GlobalEvent) => void) | undefined

  return {
    source: {
      subscribe: async (handler: (event: GlobalEvent) => void) => {
        fn = handler
        return () => {
          if (fn === handler) fn = undefined
        }
      },
    },
    emit(evt: GlobalEvent) {
      if (!fn) throw new Error("event source not ready")
      fn(evt)
    },
  }
}

async function mount() {
  const source = createSource()
  const seen: Event[] = []
  let project!: ReturnType<typeof useProject>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <SDKProvider url="http://test" directory="/tmp/root" events={source.source}>
      <ProjectProvider>
        <Probe
          onReady={(ctx) => {
            project = ctx.project
            done()
          }}
          seen={seen}
        />
      </ProjectProvider>
    </SDKProvider>
  ))

  await ready
  return { app, emit: source.emit, project, seen }
}

function Probe(props: { seen: Event[]; onReady: (ctx: { project: ReturnType<typeof useProject> }) => void }) {
  const project = useProject()
  const event = useEvent()

  onMount(() => {
    event.subscribe((evt) => {
      props.seen.push(evt)
    })
    props.onReady({ project })
  })

  return <box />
}

describe("useEvent", () => {
  test("delivers matching directory events without an active workspace", async () => {
    const { app, emit, seen } = await mount()

    try {
      emit(event(vcs("main"), { directory: "/tmp/root" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("main")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("ignores non-matching directory events without an active workspace", async () => {
    const { app, emit, seen } = await mount()

    try {
      emit(event(vcs("other"), { directory: "/tmp/other" }))
      await Bun.sleep(30)

      expect(seen).toHaveLength(0)
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers matching workspace events when a workspace is active", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(vcs("ws"), { directory: "/tmp/other", workspace: "ws_a" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("ws")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("ignores non-matching workspace events when a workspace is active", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(vcs("ws"), { directory: "/tmp/root", workspace: "ws_b" }))
      await Bun.sleep(30)

      expect(seen).toHaveLength(0)
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

      expect(seen).toEqual([update("1.2.3")])
    } finally {
      app.renderer.destroy()
    }
  })
})
