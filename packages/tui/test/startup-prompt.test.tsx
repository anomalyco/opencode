import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"
import type { TuiInput } from "../src/app"

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

async function launch(args: TuiInput["args"]) {
  const sessions: SessionInput[] = [{ id: "ses_resume" }]
  const prompts: { sessionID: string; text: string }[] = []
  const setup = await createAppFixture({
    args,
    config: { animations: false, keybinds: { "session.new": "f6" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const record: SessionInput = await request.json()
        sessions.push(record)
        return json({ data: sessionInfo(record) })
      }
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
        const body: { text: string } = await request.json()
        prompts.push({ sessionID: url.pathname.split("/")[3] ?? "", text: body.text })
        return json({ data: {} })
      }
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(agent|model)$/.test(url.pathname)) return new Response(null, { status: 204 })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname)) {
        const record = sessions.find((item) => item.id === url.pathname.split("/")[3])
        if (!record) return json({ message: "not found" }, { status: 404 })
        return json({ data: sessionInfo(record) })
      }
      return undefined
    },
  })
  return { setup, prompts }
}

test("a startup prompt sent to --session is not resubmitted by a later home view", async () => {
  const run = await launch({ sessionID: "ses_resume", prompt: "STARTUP_ONCE" })
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame(() => run.prompts.length === 1, { maxPasses: 120 })
  expect(run.prompts[0]).toEqual({ sessionID: "ses_resume", text: "STARTUP_ONCE" })

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("Demo Model") && !frame.includes("STARTUP_ONCE"))
  await setup.mockInput.typeText("NEXT_PROMPT")
  await setup.waitForFrame((frame) => frame.includes("NEXT_PROMPT"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.prompts.length === 2)
  expect(run.prompts[1]?.text).toBe("NEXT_PROMPT")
  expect(run.prompts[1]?.sessionID).not.toBe("ses_resume")
})

test("a home startup prompt is submitted once and not refilled by a later home view", async () => {
  const run = await launch({ prompt: "HOME_ONCE" })
  await using setup = run.setup

  await setup.ready
  await setup.waitForFrame(() => run.prompts.length === 1, { maxPasses: 120 })
  expect(run.prompts[0]?.text).toBe("HOME_ONCE")

  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("Demo Model") && !frame.includes("HOME_ONCE"))
  await setup.mockInput.typeText("NEXT_PROMPT")
  await setup.waitForFrame((frame) => frame.includes("NEXT_PROMPT"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => run.prompts.length === 2)
  expect(run.prompts.map((item) => item.text)).toEqual(["HOME_ONCE", "NEXT_PROMPT"])
})
