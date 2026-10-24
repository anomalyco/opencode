import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("the sidebar closes from its close button and reopens from the strip above the composer", async () => {
  await using state = await tmpdir()
  await using setup = await createFixture(state.path)
  await ready(setup)

  await setup.waitFor(() => paneWidth(setup) === 160 - 42)
  expect(setup.renderer.root.findDescendantById("session-show-sidebar")).toBeUndefined()
  await setup.mockMouse.click(node(setup, "sidebar-close").x, node(setup, "sidebar-close").y)

  await setup.waitFor(() => !setup.renderer.root.findDescendantById("sidebar-close"))
  await setup.waitFor(() => setup.config().session?.sidebar === "hide")
  await setup.waitFor(() => paneWidth(setup) === 160)
  await setup.waitFor(() => Boolean(setup.renderer.root.findDescendantById("session-show-sidebar")))

  // Settle the freshly mounted strip before reading its click coordinates.
  await setup.flush()
  const open = node(setup, "session-show-sidebar")
  await setup.mockMouse.click(open.x, open.y)

  await setup.waitFor(() => Boolean(setup.renderer.root.findDescendantById("sidebar-close")))
  await setup.waitFor(() => setup.config().session?.sidebar === "auto")
  await setup.waitFor(() => paneWidth(setup) === 160 - 42)
  await setup.waitFor(() => !setup.renderer.root.findDescendantById("session-show-sidebar"))
})

test("a narrow terminal opens the sidebar as an overlay and closes it again", async () => {
  await using state = await tmpdir()
  await using setup = await createFixture(state.path, { width: 100 })
  await ready(setup)

  expect(setup.renderer.root.findDescendantById("sidebar-close")).toBeUndefined()
  await setup.mockMouse.click(node(setup, "session-show-sidebar").x, node(setup, "session-show-sidebar").y)

  await setup.waitFor(() => Boolean(setup.renderer.root.findDescendantById("sidebar-close")))
  // Settle the overlay layout before reading its click coordinates.
  await setup.flush()
  const close = node(setup, "sidebar-close")
  await setup.mockMouse.click(close.x, close.y)

  await setup.waitFor(() => !setup.renderer.root.findDescendantById("sidebar-close"))
  await setup.waitFor(() => Boolean(setup.renderer.root.findDescendantById("session-show-sidebar")))
})

async function createFixture(state: string, input: { width?: number } = {}) {
  const session = {
    id: `ses_sidebar_${crypto.randomUUID()}`,
    title: "Panel fixture",
    projectID: "proj_sidebar",
    location: { directory },
    agent: "build",
    model: { providerID: "fixture", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 12 },
  } satisfies SessionInfo
  const location = { directory, project: { id: session.projectID, directory, canonical: directory } }
  const setup = await createAppFixture({
    width: input.width ?? 160,
    height: 36,
    state,
    args: { sessionID: session.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      // Wide terminals open the docked sidebar automatically; narrow ones overlay it on demand.
      session: { sidebar: "auto" },
    },
    fetch: async (url) => {
      if (url.pathname === "/api/location") return json({ location })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "fixture", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "fixture", name: "Fixture" }] })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: Array.from({ length: 12 }, (_, index) => ({
            id: `msg_sidebar_${String(index).padStart(2, "0")}`,
            type: "user",
            text: `Transcript item ${index}`,
            time: { created: index + 1 },
          })).toReversed(),
          cursor: {},
        })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/form`) return json({ data: [] })
      return undefined
    },
  })
  return setup
}

type Fixture = Awaited<ReturnType<typeof createAppFixture>>

async function ready(setup: Fixture) {
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Transcript item 11"), { maxPasses: 120 })
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
}

function node(setup: Fixture, id: string) {
  const result = setup.renderer.root.findDescendantById(id)
  if (!result) throw new Error(`Missing renderable: ${id}\n${setup.captureCharFrame()}`)
  return result
}

function paneWidth(setup: Fixture) {
  return setup.renderer.root.findDescendantById("session-pane")?.width ?? -1
}
