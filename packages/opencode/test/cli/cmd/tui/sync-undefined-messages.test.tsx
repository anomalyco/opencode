/** @jsxImportSource @opentui/solid */
/**
 * Reproducer for #26560 — TUI crashes with
 *   `TypeError: undefined is not an object (evaluating 'f.data.map')`
 * when entering certain sessions on v1.14.42+.
 *
 * Root cause: `packages/opencode/src/cli/cmd/tui/context/sync.tsx` uses a
 * non-null assertion on `messages.data` while the same function defensively
 * guards `todo.data` and `diff.data` with `?? []`. When the messages endpoint
 * returns a non-2xx (e.g. the v1.14.42 validation-error envelope, or any
 * transient 4xx/5xx) the SDK leaves `data` undefined and the `.map` call
 * crashes the TUI before the user can see anything.
 */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { ArgsProvider } from "../../../../src/cli/cmd/tui/context/args"
import { ExitProvider } from "../../../../src/cli/cmd/tui/context/exit"
import { KVProvider } from "../../../../src/cli/cmd/tui/context/kv"
import { ProjectProvider } from "../../../../src/cli/cmd/tui/context/project"
import { SDKProvider, type EventSource } from "../../../../src/cli/cmd/tui/context/sdk"
import { SyncProvider, useSync } from "../../../../src/cli/cmd/tui/context/sync"
import { tmpdir } from "../../../fixture/fixture"

const worktree = "/tmp/opencode"
const directory = `${worktree}/packages/opencode`
const sessionID = "ses_undef"

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
}

function eventSource(): EventSource {
  return { subscribe: async () => () => {} }
}

function createFetch() {
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))

    switch (url.pathname) {
      case "/agent":
      case "/command":
      case "/experimental/workspace":
      case "/experimental/workspace/status":
      case "/formatter":
      case "/lsp":
        return json([])
      case "/config":
      case "/experimental/resource":
      case "/mcp":
      case "/provider/auth":
      case "/session/status":
        return json({})
      case "/config/providers":
        return json({ providers: {}, default: {} })
      case "/experimental/console":
        return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
      case "/path":
        return json({ home: "", state: "", config: "", worktree, directory })
      case "/project/current":
        return json({ id: "proj_test" })
      case "/provider":
        return json({ all: [], default: {}, connected: [] })
      case "/session":
        return json([
          {
            id: sessionID,
            title: "broken",
            time: { created: 0, updated: 0 },
            version: "1.14.42",
            directory,
            project_id: "proj_test",
          },
        ])
      case "/vcs":
        return json({ branch: "main" })
      case `/session/${sessionID}`:
        return json({
          id: sessionID,
          title: "broken",
          time: { created: 0, updated: 0 },
          version: "1.14.42",
          directory,
          project_id: "proj_test",
        })
      case `/session/${sessionID}/messages`:
        // The exact failure mode from #26560: server returns a non-2xx,
        // SDK client surfaces `{ data: undefined, ... }`, the TUI's
        // unguarded `messages.data!.map(...)` crashes the whole view.
        return json({}, { status: 500 })
      case `/session/${sessionID}/todo`:
        return json([])
      case `/session/${sessionID}/diff`:
        return json([])
    }

    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch

  return { fetch }
}

async function mount() {
  const calls = createFetch()
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <ArgsProvider>
      <ExitProvider>
        <KVProvider>
          <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={eventSource()}>
            <ProjectProvider>
              <SyncProvider>
                <Probe
                  onReady={(ctx) => {
                    sync = ctx.sync
                    done()
                  }}
                />
              </SyncProvider>
            </ProjectProvider>
          </SDKProvider>
        </KVProvider>
      </ExitProvider>
    </ArgsProvider>
  ))

  await ready
  await waitFor(() => sync.status === "complete")
  return { app, sync }
}

function Probe(props: { onReady: (ctx: { sync: ReturnType<typeof useSync> }) => void }) {
  const sync = useSync()
  onMount(() => props.onReady({ sync }))
  return <box />
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

describe("tui sync (#26560)", () => {
  test("entering a session whose messages endpoint errors does not crash sync", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const { app, sync } = await mount()

    try {
      // Pre-fix this throws TypeError: undefined is not an object
      // (evaluating 'f.data.map'). Post-fix the call resolves and the
      // session simply has no messages locally cached.
      await expect(sync.session.sync(sessionID)).resolves.toBeUndefined()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })
})
