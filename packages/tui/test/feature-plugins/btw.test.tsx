import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

test("renders a generated /btw answer", async () => {
  await using state = await tmpdir()
  const generated = Promise.withResolvers<void>()
  const session = {
    id: "ses_btw",
    title: "BTW fixture",
    projectID: "proj_test",
    location: { directory },
    agent: "build",
    model: { providerID: "fixture", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
  }
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false, tabs: { enabled: false }, session: { sidebar: "hide" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/generate`) {
        generated.resolve()
        return json({ data: { text: "# Generated answer" } })
      }
      if (/^\/api\/session\/ses_btw\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("/btw summarize")
  await setup.waitForFrame((frame) => frame.includes("/btw summarize"))
  setup.mockInput.pressEscape()
  setup.mockInput.pressEnter()
  await generated.promise
  await setup.waitForFrame((frame) => frame.includes("Generated answer"))
  expect(setup.captureCharFrame()).not.toContain("PluginProvider is missing")
})
