import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

const location = { directory, project: { id: "project", directory, canonical: directory } }

function makeSession(id: string, parentID: string | undefined, title: string) {
  return {
    id,
    parentID,
    projectID: "project",
    title,
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

const main = makeSession("ses_main", undefined, "Main session")
const child = makeSession("ses_child", "ses_main", "@Coder subagent refactor")
const grandchild = makeSession("ses_gc", "ses_child", "@Search subagent lookup")
const all = [main, child, grandchild]

function fixtureFetch(
  prompts: { path: string; body: unknown }[],
  mutations: { type: string; body: unknown }[],
  sessions = all,
) {
  return async (url: URL, request: Request) => {
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: ["build", "plan"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
      })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: ["first", "second"].map((id) => ({
          id,
          providerID: "demo",
          name: `${id} model`,
          variants: [],
          cost: [],
          time: { released: 0 },
        })),
      })
    if (url.pathname === "/api/command") return json({ location, data: [] })
    if (url.pathname === "/api/session") {
      const parentID = url.searchParams.get("parentID")
      if (parentID && parentID !== "null")
        return json({ data: sessions.filter((session) => session.parentID === parentID), cursor: {} })
      return json({ data: sessions, cursor: {} })
    }
    const detail = url.pathname.match(/^\/api\/session\/(ses_\w+)$/)
    if (detail) {
      const found = sessions.find((session) => session.id === detail[1])
      return found ? json({ data: found }) : new Response(null, { status: 404 })
    }
    if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname)) return json({ data: [], cursor: {} })
    const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|model|command)$/)?.[1]
    if (type) {
      mutations.push({ type, body: await request.json() })
      return new Response(null, { status: 204 })
    }
    if (request.method === "POST" && /^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
      prompts.push({ path: url.pathname, body: await request.json() })
      return json({
        data: {
          id: "msg_test",
          sessionID: url.pathname.split("/")[3],
          type: "user",
          delivery: "steer",
          payload: { text: "hello" },
          timeCreated: new Date().toISOString(),
        },
      })
    }
    return undefined
  }
}

test("child session shows the prompt input, keeps its own agent, and commits its model", async () => {
  await using state = await tmpdir()
  const mutations: { type: string; body: unknown }[] = []
  const prompts: { path: string; body: unknown }[] = []
  // The child runs a subagent agent the composer's picker does not list; its
  // durable model must still resolve and be committed.
  const sessions = all.map((session) => (session.id === child.id ? { ...session, agent: "general" } : session))
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false },
    args: { sessionID: child.id },
    fetch: fixtureFetch(prompts, mutations, sessions),
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("No active subagents")
  await setup.mockInput.typeText("hello subagent")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => prompts.length > 0)
  expect(setup.captureCharFrame()).toContain("hello subagent")
  expect(prompts[0]).toMatchObject({ path: "/api/session/ses_child/prompt", body: { text: "hello subagent" } })
  // The child keeps its own agent, but its picker-selected model is committed to the session.
  expect(mutations).toEqual([
    { type: "model", body: { model: { providerID: "demo", id: "first" } } },
  ])
})

test("subagents dialog lists family sessions and routes messages to the selected one", async () => {
  await using state = await tmpdir()
  const mutations: { type: string; body: unknown }[] = []
  const prompts: { path: string; body: unknown }[] = []
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false },
    args: { sessionID: grandchild.id },
    fetch: fixtureFetch(prompts, mutations),
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("/subagents")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Build: refactor"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Subagents")
  expect(frame).toContain("Build: refactor")
  expect(frame).toContain("Build: lookup")

  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes("Build: refactor"))
  expect(row).toBeGreaterThan(0)
  await setup.mockMouse.click(30, row)

  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("hi refactor")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => prompts.length > 0)
  expect(prompts[0]).toMatchObject({ path: "/api/session/ses_child/prompt", body: { text: "hi refactor" } })
})

test("subagents dialog separates teams with headings and a divider", async () => {
  await using state = await tmpdir()
  const mutations: { type: string; body: unknown }[] = []
  const prompts: { path: string; body: unknown }[] = []
  const teamSessions = [
    makeSession("ses_main", undefined, "Main session"),
    makeSession("ses_a1", "ses_main", "alpha-1 (leader) — work"),
    makeSession("ses_a2", "ses_main", "alpha-2 (member) — work"),
    makeSession("ses_b1", "ses_main", "beta-1 (leader) — work"),
  ]
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false },
    args: { sessionID: "ses_main" },
    fetch: fixtureFetch(prompts, mutations, teamSessions),
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("/subagents")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("alpha-1 (leader)"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("alpha")
  expect(frame).toContain("beta")
  expect(frame).toContain("alpha-2 (member)")
  expect(frame).toContain("─")

  const lines = frame.split("\n")
  const boss = lines.findIndex((line) => line.includes("Build: Main session"))
  const team = lines.findIndex((line) => line.includes("alpha-1 (leader)"))
  expect(boss).toBeGreaterThanOrEqual(0)
  expect(team).toBeGreaterThan(boss)
})
