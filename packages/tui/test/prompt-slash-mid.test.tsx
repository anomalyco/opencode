import { expect, test } from "bun:test"
import { directory, json, type FetchHandler } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

const location = { directory, project: { id: "project", directory, canonical: directory } }

function sessionFixture() {
  return {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Slash mid-prompt fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

function fixtureFetch(session: ReturnType<typeof sessionFixture>, submitted: unknown[]): FetchHandler {
  return async (url, request) => {
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: [{ id: "first", providerID: "demo", name: "first model", variants: [], cost: [], time: { released: 0 } }],
      })
    if (url.pathname === "/api/command")
      return json({ location, data: [{ name: "review", description: "Review the input" }] })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
      return json({ data: [], cursor: {} })
    if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
      submitted.push(await request.json())
      return json({ data: {} })
    }
    return undefined
  }
}

test("completes a custom command mid-prompt without clearing the prefix", async () => {
  await using state = await tmpdir()
  const session = sessionFixture()
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false },
    args: { sessionID: session.id },
    fetch: fixtureFetch(session, []),
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build ·"))

  await setup.mockInput.typeText("explain /rev")
  await setup.waitForFrame((frame) => frame.includes("/review") && frame.includes("Review the input"))

  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("explain /review"))
})

test("submits a sentence with a spaced slash instead of swallowing Enter", async () => {
  await using state = await tmpdir()
  const session = sessionFixture()
  const submitted: unknown[] = []
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false },
    args: { sessionID: session.id },
    fetch: fixtureFetch(session, submitted),
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build ·"))

  await setup.mockInput.typeText("Do not use 'find /'")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => submitted.length > 0)
  expect(submitted[0]).toMatchObject({ text: "Do not use 'find /'" })
})

test("submits a sentence with a bare trailing slash", async () => {
  await using state = await tmpdir()
  const session = sessionFixture()
  const submitted: unknown[] = []
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false },
    args: { sessionID: session.id },
    fetch: fixtureFetch(session, submitted),
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build ·"))

  await setup.mockInput.typeText("find /")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => submitted.length > 0)
  expect(submitted[0]).toMatchObject({ text: "find /" })
})
