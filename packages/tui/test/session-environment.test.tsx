import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json, worktree } from "./fixture/tui-client"

const location = {
  directory,
  project: { id: "proj_test", directory: worktree, canonical: worktree },
}

function makeSession(overrides: { title?: string; updated?: number; busy?: number } = {}) {
  return {
    id: "ses_shared",
    projectID: "proj_test",
    location: { directory },
    title: overrides.title ?? "Initial title",
    agent: "build",
    model: { providerID: "demo", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: 1,
      updated: overrides.updated ?? 1,
      ...(overrides.busy !== undefined ? { busy: overrides.busy } : {}),
    },
  }
}

test("idle terminal does not re-upload session environment when session record updates", async () => {
  let current = makeSession()
  let sessionGets = 0
  const initialEnv = Promise.withResolvers<void>()
  const refreshed = Promise.withResolvers<void>()
  const environments: Record<string, string>[] = []

  await using setup = await createAppFixture({
    width: 140,
    height: 30,
    args: { sessionID: current.id },
    environment: { PROBE: "A" },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session") return json({ data: [current], cursor: {} })
      if (url.pathname === `/api/session/${current.id}`) {
        sessionGets++
        if (sessionGets >= 2 && current.time.updated >= 2) refreshed.resolve()
        return json({ data: current })
      }
      if (url.pathname === `/api/session/${current.id}/environment` && request.method === "PUT") {
        const body: { variables: Record<string, string> } = await request.json()
        environments.push(body.variables)
        if (environments.length === 1) initialEnv.resolve()
        return new Response(null, { status: 204 })
      }
      if (/^\/api\/session\/ses_shared\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      return undefined
    },
  })

  await setup.ready
  await initialEnv.promise
  await setup.waitForFrame((frame) => frame.includes("Initial title"))
  expect(environments).toEqual([{ PROBE: "A" }])

  // Simulate another terminal sending a prompt on the same session:
  // session.execution.started and session.renamed revalidate and replace the session record.
  current = makeSession({ title: "Updated from terminal B", updated: 2, busy: 2 })
  setup.events.emit({
    id: "evt_started",
    created: 2,
    durable: { aggregateID: current.id, seq: 1, version: 1 },
    type: "session.execution.started",
    data: { sessionID: current.id },
  })
  setup.events.emit({
    id: "evt_renamed",
    created: 3,
    durable: { aggregateID: current.id, seq: 2, version: 1 },
    type: "session.renamed",
    data: { sessionID: current.id, title: current.title },
  })
  setup.events.emit({
    id: "evt_succeeded",
    created: 4,
    durable: { aggregateID: current.id, seq: 3, version: 1 },
    type: "session.execution.succeeded",
    data: { sessionID: current.id },
  })

  await refreshed.promise
  await setup.waitForFrame((frame) => frame.includes("Updated from terminal B"))
  await setup.renderOnce()
  expect(environments).toEqual([{ PROBE: "A" }])
})

test("submitting a prompt or shell command on an existing session uploads its environment first", async () => {
  const session = makeSession()
  const initialEnv = Promise.withResolvers<void>()
  const prompted = Promise.withResolvers<void>()
  const shelled = Promise.withResolvers<void>()
  const writes: Array<{ method: string; path: string; variables?: Record<string, string> }> = []

  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: session.id },
    environment: { PROBE: "B" },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/environment` && request.method === "PUT") {
        const body: { variables: Record<string, string> } = await request.json()
        writes.push({ method: request.method, path: url.pathname, variables: body.variables })
        initialEnv.resolve()
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${session.id}/prompt` && request.method === "POST") {
        writes.push({ method: request.method, path: url.pathname })
        prompted.resolve()
        return json({ data: {} })
      }
      if (url.pathname === `/api/session/${session.id}/shell` && request.method === "POST") {
        writes.push({ method: request.method, path: url.pathname })
        shelled.resolve()
        return new Response(null, { status: 204 })
      }
      if (/^\/api\/session\/ses_shared\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      return undefined
    },
  })

  await setup.ready
  await initialEnv.promise
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  writes.length = 0

  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await prompted.promise

  const promptEnvIndex = writes.findIndex(
    (entry) => entry.method === "PUT" && entry.path === `/api/session/${session.id}/environment`,
  )
  const promptIndex = writes.findIndex(
    (entry) => entry.method === "POST" && entry.path === `/api/session/${session.id}/prompt`,
  )
  expect(promptEnvIndex).toBeGreaterThanOrEqual(0)
  expect(promptIndex).toBeGreaterThan(promptEnvIndex)
  expect(writes[promptEnvIndex]?.variables).toEqual({ PROBE: "B" })

  writes.length = 0
  await setup.mockInput.typeText("!echo probe=$PROBE")
  setup.mockInput.pressEnter()
  await shelled.promise

  const shellEnvIndex = writes.findIndex(
    (entry) => entry.method === "PUT" && entry.path === `/api/session/${session.id}/environment`,
  )
  const shellIndex = writes.findIndex(
    (entry) => entry.method === "POST" && entry.path === `/api/session/${session.id}/shell`,
  )
  expect(shellEnvIndex).toBeGreaterThanOrEqual(0)
  expect(shellIndex).toBeGreaterThan(shellEnvIndex)
  expect(writes[shellEnvIndex]?.variables).toEqual({ PROBE: "B" })
})
