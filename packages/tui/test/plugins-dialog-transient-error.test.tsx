import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_plugins",
  title: "Plugins fixture",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

test("the plugins dialog reports a transient HTML response instead of crashing", async () => {
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    config: { animations: false },
    fetch: (url) => {
      // A proxy that answers API calls with its own HTML page while the backend is unavailable.
      if (url.pathname === "/api/plugin")
        return new Response("<html><body>proxy error</body></html>", {
          headers: { "content-type": "text/html" },
        })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })

  await setup.waitForFrame((frame) => frame.includes("Plugins fixture"))
  await setup.mockInput.typeText("/plugins")
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame(
    (frame) => frame.includes("OpenCode crashed") || frame.includes("Failed to load plugins"),
  )

  expect(frame).not.toContain("OpenCode crashed")
  expect(frame).toContain("Failed to load plugins")
}, 30000)
