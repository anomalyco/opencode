import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("Home and End navigate a subagent transcript", async () => {
  const session = {
    id: "ses_subagent_navigation",
    parentID: "ses_parent",
    title: "Subagent",
    agent: "build",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: `Message ${index}`,
    time: { created: index },
  }))
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    },
  })
  await setup.ready
  expect(
    await setup.waitForFrame((frame) => frame.includes("Message 19") && frame.includes("Subagents")),
  ).not.toContain("Message 0")
  setup.mockInput.pressKey("HOME")
  expect(await setup.waitForFrame((frame) => frame.includes("Message 0"))).not.toContain("Message 19")
  setup.mockInput.pressKey("END")
  expect(await setup.waitForFrame((frame) => frame.includes("Message 19"))).not.toContain("Message 0")
})
