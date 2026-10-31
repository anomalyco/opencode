import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "project", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

function sessionInfo(record: { id?: string }) {
  return {
    id: record.id,
    location: { directory: location.directory },
    projectID: "project",
    agent: "build",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

test("a model switch waits for the server to know the session it targets", async () => {
  const created: { id?: string }[] = []
  // The create response is held back: the session exists on the client while
  // the server still rejects every session-scoped write for it.
  const create = Promise.withResolvers<void>()
  let createAnswered = false
  const switched = Promise.withResolvers<{ id: string; createAnswered: boolean }>()
  const requests: string[] = []
  const setup = await createAppFixture({
    config: { animations: false },
    fetch: async (url, request) => {
      requests.push(`${request.method} ${url.pathname}`)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const record = (await request.json()) as { id?: string }
        created.push(record)
        await create.promise
        createAnswered = true
        return json({ data: sessionInfo(record) })
      }
      if (/^\/api\/session\/[^/]+\/model$/.test(url.pathname)) {
        switched.resolve({ id: url.pathname.split("/")[3] ?? "", createAnswered })
        return new Response(null, { status: 204 })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) return json({ data: {} })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) return json({ message: "not found" }, { status: 404 })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission|form)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/agent$/.test(url.pathname)) return new Response(null, { status: 204 })
      return undefined
    },
  })
  await using _ = setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  const homeEditor = setup.renderer.currentFocusedEditor

  // Sending a prompt creates the session and opens it in a tab.
  setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => created.length === 1)
  // The session route reads the session-scoped collections it needs.
  await setup.waitForFrame(() => requests.some((entry) => entry.endsWith("/permission")))
  // The session tab owns the composer now.
  await setup.waitForFrame(
    () => setup.renderer.currentFocusedEditor !== undefined && setup.renderer.currentFocusedEditor !== homeEditor,
  )

  // A blank Enter in the session tab commits the composer selection, while
  // the create request is still in flight.
  setup.mockInput.pressEnter()

  // The server rejects a model switch for a session it has not stored yet, so
  // the switch may not leave before the create was answered.
  const early = await Promise.race([
    switched.promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2000)),
  ])
  create.resolve()
  const sent = await switched.promise

  expect(early).toBeUndefined()
  // The switch carries the session id the client minted, unmodified.
  const createdID = created[0]?.id
  if (!createdID) throw new Error("the session was never created")
  expect(sent.id).toBe(createdID)
  expect(sent.id).not.toBe(sent.id.toUpperCase())
  expect(sent.createAnswered).toBe(true)
})
