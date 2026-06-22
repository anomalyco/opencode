/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup, onMount } from "solid-js"
import { DialogSessionList } from "../../../../src/component/dialog-session-list"
import { ArgsProvider } from "../../../../src/context/args"
import { ExitProvider } from "../../../../src/context/exit"
import { KVProvider, useKV } from "../../../../src/context/kv"
import { LocalProvider, useLocal } from "../../../../src/context/local"
import { ProjectProvider } from "../../../../src/context/project"
import { PermissionProvider } from "../../../../src/context/permission"
import { RouteProvider, useRoute } from "../../../../src/context/route"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { ThemeProvider } from "../../../../src/context/theme"
import { TuiConfigProvider } from "../../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../../src/keymap"
import { DialogProvider } from "../../../../src/ui/dialog"
import { ToastProvider } from "../../../../src/ui/toast"
import { tmpdir } from "../../../fixture/fixture"
import { createTuiResolvedConfig } from "../../../fixture/tui-runtime"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { createEventSource, createFetch, directory, json, type FetchHandler, worktree } from "../../../fixture/tui-sdk"
import type { GlobalSession, Session } from "@opencode-ai/sdk/v2"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

const now = Date.now()
const scopedSession = session({ id: "ses_scoped_root", title: "Scoped root", directory, time: now - 1 })
const globalSession: GlobalSession = {
  ...session({
    id: "ses_global_root",
    title: "Global root",
    directory: `${worktree}/other-project/app`,
    time: now,
  }),
  project: { id: "proj_other", name: "Other project", worktree: `${worktree}/other-project` },
}
const globalChild: GlobalSession = {
  ...session({
    id: "ses_global_child",
    title: "Global child",
    directory: `${worktree}/other-project/app`,
    parentID: globalSession.id,
    time: now + 1,
  }),
  project: globalSession.project,
}

test("session picker toggles global rows without leaking hydrated sessions into scoped browse", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  await Bun.write(`${tmp.path}/session.json`, "{}")
  const mounted = await mountDialog(tmp.path, (url) => {
    if (url.pathname === "/session") return json([scopedSession])
    if (url.pathname === "/experimental/session") return json([globalChild, globalSession])
    if (url.pathname === `/session/${globalSession.id}`) return json(globalSession)
    if (url.pathname === `/session/${globalSession.id}/message`) return json([])
    if (url.pathname === `/session/${globalSession.id}/todo`) return json([])
    if (url.pathname === `/session/${globalSession.id}/diff`) return json([])
  })

  try {
    await wait(() => mounted.sync.status === "complete" && mounted.local.session.ready)
    await wait(() => mounted.frame().includes("Scoped root"))

    expect(mounted.frame()).toContain("Sessions")
    expect(mounted.frame()).toContain("Scoped root")
    expect(mounted.frame()).not.toContain("Global root")

    mounted.kv.set("session_list_global_enabled", true)
    await wait(() => mounted.frame().includes("Sessions (global)") && mounted.frame().includes("Global root"))

    expect(mounted.frame()).toContain("Other project")
    expect(mounted.frame()).toContain(`${worktree}/other-project/app`)
    expect(mounted.frame()).not.toContain("Global child")
    expect(mounted.experimentalSession.at(-1)?.searchParams.get("roots")).toBe("true")

    mounted.local.session.togglePin(globalSession.id)
    expect(mounted.local.session.pinned()).toContain(globalSession.id)
    expect(mounted.local.session.slots()).not.toContain(globalSession.id)

    mounted.app.mockInput.pressEnter()
    await wait(() => mounted.route.data.type === "session" && mounted.route.data.sessionID === globalSession.id)
    await mounted.sync.session.sync(globalSession.id)
    await wait(() => mounted.sync.session.get(globalSession.id) !== undefined)
    await wait(() => mounted.local.session.slots().includes(globalSession.id))

    mounted.kv.set("session_list_global_enabled", false)
    await wait(() => mounted.frame().includes("Scoped root") && !mounted.frame().includes("Global root"))

    expect(mounted.session.at(-1)?.searchParams.get("roots")).toBe("true")
    expect(mounted.local.session.pinned()).toContain(globalSession.id)
  } finally {
    mounted.app.renderer.destroy()
  }
})

async function mountDialog(state: string, override: FetchHandler) {
  const calls = createFetch(override)
  const events = createEventSource()
  let kv!: ReturnType<typeof useKV>
  let local!: ReturnType<typeof useLocal>
  let route!: ReturnType<typeof useRoute>
  let sync!: ReturnType<typeof useSync>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  function Probe() {
    kv = useKV()
    local = useLocal()
    route = useRoute()
    sync = useSync()
    onMount(done)
    return <DialogSessionList />
  }

  function Harness() {
    const renderer = useRenderer()
    const config = createTuiResolvedConfig()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const dispose = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(dispose)

    return (
      <TestTuiContexts paths={{ state }}>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <ArgsProvider>
              <KVProvider>
                <ExitProvider exit={(error) => { throw error }}>
                  <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
                    <PermissionProvider>
                      <ProjectProvider>
                        <SyncProvider>
                          <RouteProvider>
                            <ThemeProvider mode="dark">
                              <ToastProvider>
                                <DialogProvider>
                                  <LocalProvider>
                                    <Probe />
                                  </LocalProvider>
                                </DialogProvider>
                              </ToastProvider>
                            </ThemeProvider>
                          </RouteProvider>
                        </SyncProvider>
                      </ProjectProvider>
                    </PermissionProvider>
                  </SDKProvider>
                </ExitProvider>
              </KVProvider>
            </ArgsProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  await ready
  return {
    app,
    experimentalSession: calls.experimentalSession,
    frame: () => app.captureCharFrame(),
    kv,
    local,
    route,
    session: calls.session,
    sync,
  }
}

function session(input: { id: string; title: string; directory: string; parentID?: string; time: number }): Session {
  return {
    id: input.id,
    slug: input.id.replace("ses_", ""),
    projectID: "proj_test",
    directory: input.directory,
    parentID: input.parentID,
    title: input.title,
    version: "test",
    time: { created: input.time, updated: input.time },
  }
}
