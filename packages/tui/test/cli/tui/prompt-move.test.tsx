/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { usePromptMove } from "../../../src/component/prompt/move"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider, useToast } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const main = "/tmp/opencode/main"
const clone = "/tmp/opencode/other-clone"
const linked = "/tmp/opencode/linked"
const created = "/tmp/opencode/proj_t/fresh"

test.each([
  { name: "a cached session in another clone", directory: clone, warm: true },
  { name: "an uncached session in a clone subdirectory", directory: `${clone}/packages/tui` },
  { name: "an uncached session in a linked worktree", directory: linked, worktree: linked },
  { name: "a session in a linked worktree subdirectory", directory: `${linked}/packages/tui`, worktree: linked },
  { name: "the home/default location", directory: `${clone}/packages/tui`, home: true },
])("creates from the clone's main worktree for $name", async (input) => {
  const fixture = await renderMove(input)
  try {
    await fixture.data.project.sync()
    expect(fixture.data.project.get("proj_test")?.canonical).toBe(main)
    if (input.warm) {
      await fixture.data.session.sync("ses_clone")
      await fixture.data.location.syncInfo({ directory: input.directory })
    }
    if (!input.home && !input.warm) {
      expect(fixture.data.session.get("ses_clone")).toBeUndefined()
      expect(fixture.data.location.info({ directory: input.directory })).toBeUndefined()
    }

    await fixture.create()

    expect(fixture.requests).toEqual([
      { strategy: "git", from: clone, directory: "/tmp/opencode/proj_t", name: "fresh" },
    ])
    expect(fixture.data.location.info({ directory: created })?.project.canonical).toBe(clone)
    expect(fixture.reads.locations.filter((directory) => directory === input.directory)).toHaveLength(1)
    expect(fixture.reads.session).toBe(input.home ? 0 : 1)
    expect(fixture.moves).toEqual(input.home ? [] : [{ directory: created }])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test.each(["session", "location"] as const)(
  "does not create from another clone when %s lookup fails",
  async (unavailable) => {
    const fixture = await renderMove({ directory: `${linked}/packages/tui`, worktree: linked, unavailable })
    try {
      await fixture.create()

      expect(fixture.requests).toEqual([])
      expect(fixture.moves).toEqual([])
      expect(fixture.toast.currentToast).toMatchObject({ title: "Creating workspace failed", variant: "error" })
      expect(fixture.move.creating()).toBe(false)
    } finally {
      fixture.app.renderer.destroy()
    }
  },
)

async function renderMove(input: {
  directory: string
  worktree?: string
  home?: boolean
  unavailable?: "session" | "location"
}) {
  const launch = input.home ? input.directory : main
  const requests: unknown[] = []
  const moves: unknown[] = []
  const reads = { session: 0, locations: [] as string[] }
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/location") {
      const directory = url.searchParams.get("location[directory]") ?? launch
      reads.locations.push(directory)
      if (input.unavailable === "location" && directory === input.directory)
        return json({ message: "Location unavailable" }, { status: 503 })
      return json({
        directory,
        project: {
          id: "proj_test",
          directory: directory === input.directory ? (input.worktree ?? clone) : directory,
          canonical: directory === input.directory || directory === created ? clone : main,
        },
      })
    }
    if (url.pathname === "/api/project")
      return json([{ id: "proj_test", canonical: main, time: { created: 1, updated: 1 }, sandboxes: [] }])
    if (url.pathname === "/api/project/current")
      return json({ id: "proj_test", directory: launch, canonical: input.home ? clone : main })
    if (url.pathname === "/api/session/ses_clone") {
      reads.session++
      if (input.unavailable === "session") return json({ message: "Session unavailable" }, { status: 404 })
      return json({
        data: {
          id: "ses_clone",
          projectID: "proj_test",
          location: { directory: input.directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        },
      })
    }
    if (url.pathname === "/api/worktree/proj_test") {
      if (request.method === "GET")
        return json([{ directory: main }, { directory: clone }, { directory: linked, strategy: "git" }])
      if (request.method === "POST") {
        requests.push(await request.json())
        return json({ directory: created })
      }
    }
    if (url.pathname === "/api/session/ses_clone/move") {
      moves.push(await request.json())
      return new Response(null, { status: 204 })
    }
    return undefined
  }, createEventStream())
  let data!: ReturnType<typeof useData>
  let move!: ReturnType<typeof usePromptMove>
  let toast!: ReturnType<typeof useToast>

  function Probe() {
    data = useData()
    toast = useToast()
    move = usePromptMove({ projectID: () => "proj_test", sessionID: () => (input.home ? undefined : "ses_clone") })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts cwd={launch}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider directory={launch}>
                    <ThemeProvider mode="dark" source={emptyThemeSource}>
                      <DialogProvider>
                        <Probe />
                      </DialogProvider>
                    </ThemeProvider>
                  </DataProvider>
                </ClientProvider>
              </RouteProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitFor(() => move !== undefined)

  return {
    app,
    data,
    move,
    toast,
    requests,
    moves,
    reads,
    async create() {
      await move.open()
      await app.waitForFrame((frame) => frame.includes("Move session") && frame.includes(clone))
      app.mockInput.pressKey("m", { ctrl: true })
      await app.waitForFrame((frame) => frame.includes("Name worktree"))
      await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
      await app.mockInput.typeText("fresh")
      app.mockInput.pressEnter()
      if (input.home) {
        await app.waitFor(() => move.pendingNew())
        await move.getDirectory()
        return
      }
      await app.waitFor(() => moves.length > 0 || toast.currentToast !== null)
    },
  }
}
