import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

type SessionInput = { id?: string; location?: { directory: string } }

const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "project", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

function sessionInfo(record: SessionInput) {
  return {
    ...record,
    location: record.location ?? { directory: location.directory },
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

async function launch(options: { failCreates?: number; existing?: string[] } = {}) {
  const attempts: (string | undefined)[] = []
  const created: SessionInput[] = []
  const prompts: string[] = []
  let failures = options.failCreates ?? 0
  const setup = await createAppFixture({
    args: { createSessionID: "ses_chosen" },
    config: { animations: false, keybinds: { "session.new": "f6" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const input: unknown = await request.json()
        if (typeof input !== "object" || input === null) throw new Error("Expected a session input")
        const record = input as SessionInput
        attempts.push(record.id)
        if (failures > 0) {
          failures--
          return json({ message: "create failed" }, { status: 500 })
        }
        created.push(record)
        return json({ data: sessionInfo(record) })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        prompts.push(url.pathname.split("/")[3] ?? "")
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(agent|model)$/.test(url.pathname)) return new Response(null, { status: 204 })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) {
        const id = url.pathname.split("/")[3] ?? ""
        if (options.existing?.includes(id)) return json({ data: sessionInfo({ id }) })
        const record = created.find((item) => item.id === id)
        if (!record) return json({ message: "not found" }, { status: 404 })
        return json({ data: sessionInfo(record) })
      }
      return undefined
    },
  })
  return { setup, attempts, created, prompts }
}

test("a launch createSessionID seeds the first fresh session and is consumed once", async () => {
  const run = await launch()
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.prompts.length === 1)
  expect(run.prompts[0]).toBe("ses_chosen")
  expect(run.created).toHaveLength(1)
  expect(run.created[0]?.id).toBe("ses_chosen")

  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  await setup.mockInput.typeText("again")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.created.length === 2)
  expect(run.created[1]?.id).toMatch(/^ses/)
  expect(run.created[1]?.id).not.toBe("ses_chosen")
})

test("a failed first create keeps the launch createSessionID for the retry", async () => {
  const run = await launch({ failCreates: 1 })
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  // Retry only once the failed prompt is back in the input.
  await setup.waitForFrame((frame) => frame.includes("Creating a session failed") && frame.includes("hello"))
  expect(run.attempts).toEqual(["ses_chosen"])

  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.created.length === 1)
  expect(run.attempts).toEqual(["ses_chosen", "ses_chosen"])
  expect(run.created[0]?.id).toBe("ses_chosen")
})

test("a launch createSessionID that already exists is reported and never created", async () => {
  const run = await launch({ existing: ["ses_chosen"] })
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Session already exists: ses_chosen"))
  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.created.length === 1)
  expect(run.attempts[0]).toMatch(/^ses/)
  expect(run.attempts[0]).not.toBe("ses_chosen")
})
