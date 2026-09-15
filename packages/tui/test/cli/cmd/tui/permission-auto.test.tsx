/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { ExitProvider } from "../../../../src/context/exit"
import { KVProvider } from "../../../../src/context/kv"
import { PermissionProvider, usePermission } from "../../../../src/context/permission"
import { ProjectProvider } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { createEventSource, createFetch, directory, json } from "../../../fixture/tui-sdk"
import { wait } from "./sync-fixture"

type Call = { method: string; path: string }

// Stands in for the instance server. `leases: false` reproduces a server
// predating /permission/auto, which the TUI must still drive client-side.
function createLeaseServer(input?: { leases?: boolean }) {
  const calls: Call[] = []
  const replied: string[] = []
  const held = new Set<string>()
  let next = 0

  const handler = async (url: URL, request: Request) => {
    if (!url.pathname.startsWith("/permission")) return undefined
    calls.push({ method: request.method, path: url.pathname })

    if (url.pathname.endsWith("/reply")) {
      replied.push(url.pathname.split("/")[2]!)
      return json(true)
    }
    if (input?.leases === false) return json({ message: "not found" }, { status: 404 })
    if (url.pathname === "/permission/auto" && request.method === "POST") {
      const id = `pal_test${(next += 1)}`
      held.add(id)
      return json({ id, scope: { type: "instance" }, ttl: 30000, expires: Date.now() + 30000 })
    }

    const id = url.pathname.split("/")[3]!
    if (request.method === "DELETE") return json(held.delete(id))
    if (!held.has(id)) return json({ message: "not found" }, { status: 404 })
    return json({ id, scope: { type: "instance" }, ttl: 30000, expires: Date.now() + 30000 })
  }

  return { handler, calls, replied, held }
}

async function mount(input?: { auto?: boolean; leases?: boolean }) {
  const server = createLeaseServer(input)
  const events = createEventSource()
  // `createFetch` only passes the URL through, but a lease API needs the method
  // and the request, so intercept before handing over to the shared fixture.
  const base = createFetch()
  const fetch = (async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(resource as RequestInfo, init)
    return (await server.handler(new URL(request.url), request)) ?? base.fetch(resource, init)
  }) as typeof globalThis.fetch

  let permission!: ReturnType<typeof usePermission>
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    const permissionCtx = usePermission()
    const syncCtx = useSync()
    onMount(() => {
      permission = permissionCtx
      sync = syncCtx
      done()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ArgsProvider auto={input?.auto}>
        <KVProvider>
          <SDKProvider url="http://test" directory={directory} fetch={fetch} events={events.source}>
            <PermissionProvider>
              <ProjectProvider>
                <ExitProvider exit={() => {}}>
                  <SyncProvider>
                    <Probe />
                  </SyncProvider>
                </ExitProvider>
              </ProjectProvider>
            </PermissionProvider>
          </SDKProvider>
        </KVProvider>
      </ArgsProvider>
    </TestTuiContexts>
  ))

  await ready
  await wait(() => sync.status === "complete")
  return {
    app,
    calls: server.calls,
    replied: server.replied,
    held: server.held,
    emit: events.emit,
    get permission() {
      return permission
    },
  }
}

function askedEvent(requestID: string): GlobalEvent {
  return {
    directory,
    project: "proj_test",
    payload: {
      id: "evt_asked",
      type: "permission.asked",
      properties: {
        id: requestID,
        sessionID: "ses_test",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
      },
    },
  }
}

test("--auto takes a lease instead of replying to permissions itself", async () => {
  const harness = await mount({ auto: true })
  try {
    await wait(() => harness.permission.managed)
    expect(harness.permission.mode).toBe("auto")
    expect(harness.calls).toContainEqual({ method: "POST", path: "/permission/auto" })
    expect(harness.held.size).toBe(1)

    // A managed server only publishes this when a human really is needed, so
    // the TUI must surface it rather than approving it behind their back.
    harness.emit(askedEvent("per_managed"))
    await Bun.sleep(50)
    expect(harness.replied).toEqual([])
  } finally {
    harness.app.renderer.destroy()
  }
})

// Regression for opencode#47545: an older server never suppresses
// permission.asked, so the TUI has to keep replying itself.
test("keeps replying client-side when the server has no lease route", async () => {
  const harness = await mount({ auto: true, leases: false })
  try {
    await wait(() => harness.calls.some((call) => call.path === "/permission/auto"))
    expect(harness.permission.mode).toBe("auto")
    expect(harness.permission.managed).toBe(false)

    harness.emit(askedEvent("per_legacy"))
    await wait(() => harness.replied.length === 1)
    expect(harness.replied).toEqual(["per_legacy"])
  } finally {
    harness.app.renderer.destroy()
  }
})

test("toggling auto mode acquires and releases the lease", async () => {
  const harness = await mount()
  try {
    expect(harness.permission.mode).toBe("normal")
    expect(harness.held.size).toBe(0)

    harness.permission.toggle()
    await wait(() => harness.permission.managed)
    expect(harness.permission.mode).toBe("auto")
    expect(harness.held.size).toBe(1)

    harness.permission.toggle()
    await wait(() => harness.held.size === 0)
    expect(harness.permission.mode).toBe("normal")
    expect(harness.permission.managed).toBe(false)

    // Back in normal mode the TUI shows the prompt instead of answering it.
    harness.emit(askedEvent("per_normal"))
    await Bun.sleep(50)
    expect(harness.replied).toEqual([])
  } finally {
    harness.app.renderer.destroy()
  }
})

test("leaving the TUI releases the lease", async () => {
  const harness = await mount({ auto: true })
  await wait(() => harness.permission.managed)
  expect(harness.held.size).toBe(1)

  harness.app.renderer.destroy()
  await wait(() => harness.held.size === 0)
})
