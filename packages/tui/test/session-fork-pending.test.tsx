import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_fork_pending",
  title: "Fork pending",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const messages = [
  {
    type: "assistant",
    id: "msg_b",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    finish: "stop",
    time: { created: 2, completed: 3 },
    content: [{ type: "text", text: "First answer" }],
  },
  { type: "user", id: "msg_a", text: "First prompt", time: { created: 1 } },
]

test("choosing a row in /fork shows the pending view until the fork finishes", async () => {
  const fork = Promise.withResolvers<Response>()
  const requested = Promise.withResolvers<void>()
  await using setup = await createAppFixture({
    width: 112,
    height: 34,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/fork`) {
        requested.resolve()
        return fork.promise
      }
      if (/^\/api\/session\/ses_fork_pending\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: url.pathname.endsWith("/message") ? messages : [], cursor: {} })
      return undefined
    },
  })

  try {
    await setup.waitForFrame((frame) => frame.includes("First answer"))
    await setup.mockInput.typeText("/fork")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Fork session") && frame.includes("Full session"))
    setup.mockInput.pressEnter()
    await requested.promise
    await setup.waitForFrame((frame) => frame.includes("Forking session") && !frame.includes("Full session"))
    expect(setup.captureCharFrame()).toContain("Fork session")
  } finally {
    fork.resolve(new Response(null, { status: 500 }))
  }
}, 20000)
