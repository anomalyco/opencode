import { expect, test } from "bun:test"
import type { SessionPromptInput } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

async function launch(options: { unavailable?: boolean; rejected?: boolean } = {}) {
  const prompts: SessionPromptInput[] = []
  const switches: string[] = []
  const directory = "/tmp/opencode/packages/tui"
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const session = {
    id: "ses_queue",
    title: "Build in progress",
    location: { directory },
    projectID: "proj_test",
    agent: "build",
    model: { providerID: "demo", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const app = await createAppFixture({
    args: { sessionID: session.id },
    config: { animations: false, keybinds: { "agent.cycle": "tab", "prompt.queue": "f6" } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session/active") return json({ data: { [session.id]: { type: "running" } } })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/command") return json({ location, data: [{ name: "review" }] })
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["build", "plan"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: options.unavailable ? [] : [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }],
        })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission|form)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/prompt` ||
        url.pathname === `/api/session/${session.id}/command`
      ) {
        const body: SessionPromptInput = await request.json()
        prompts.push(body)
        if (options.rejected) return json({ message: "Admission rejected" }, { status: 500 })
        if (url.pathname.endsWith("/command")) return new Response(null, { status: 204 })
        return json({
          data: {
            id: body.id,
            sessionID: session.id,
            type: "user",
            payload: body,
            delivery: "queue",
            time: { created: 1 },
          },
        })
      }
      if (request.method === "POST" && /\/(agent|model)$/.test(url.pathname)) {
        switches.push(url.pathname)
        return new Response(null, { status: 204 })
      }
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes(options.unavailable ? "Build ·" : "Build · Demo Model"))
  app.mockInput.pressTab()
  await app.waitForFrame((frame) => /plan/i.test(frame))
  return { app, prompts, switches }
}

test.each(["keybind", "command"])(
  "%s queue captures the draft agent without switching the running session",
  async (mode) => {
    const { app: fixture, prompts, switches } = await launch()
    await using app = fixture
    await app.mockInput.typeText(
      mode === "command" ? "/review Review the result" : "Review the result",
    )
    app.mockInput.pressKey("F6")
    await app.waitForFrame(() => prompts.length === 1)
    await app.renderOnce()
    await app.renderOnce()
    expect(prompts[0]).toMatchObject({
      text: "Review the result",
      agent: "plan",
      model: { providerID: "demo", id: "model" },
      delivery: "queue",
    })
    expect(switches).toEqual([])
  },
)

test("rejected queued admission restores the draft", async () => {
  const { app: fixture, prompts, switches } = await launch({ rejected: true })
  await using app = fixture
  await app.mockInput.typeText("Review the result")
  app.mockInput.pressKey("F6")
  await app.waitForFrame(
    (frame) =>
      prompts.length === 1 && frame.includes("Failed to send prompt") && frame.includes("Review the result"),
  )
  expect(switches).toEqual([])
})

test("queueing without an available model preserves the draft without admission", async () => {
  const { app: fixture, prompts, switches } = await launch({ unavailable: true })
  await using app = fixture
  await app.mockInput.typeText("Review the result")
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => frame.includes("Connect an integration to send prompts"))
  expect(app.captureCharFrame()).toContain("Review the result")
  expect(prompts).toEqual([])
  expect(switches).toEqual([])
})
