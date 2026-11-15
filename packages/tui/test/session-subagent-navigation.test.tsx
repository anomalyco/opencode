import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("a subagent session takes prompts and reaches its parent through the picker", async () => {
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const base = {
    projectID: "proj_test",
    model: { providerID: "demo", id: "model" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const parent = { ...base, id: "ses_parent", title: "Parent session", agent: "build" }
  const child = { ...base, id: "ses_child", parentID: parent.id, title: "Inspect the code", agent: "explore" }
  const messages = {
    [parent.id]: [{ id: "msg_parent", type: "user", text: "Parent message", time: { created: 0 } }],
    [child.id]: [{ id: "msg_child", type: "user", text: "Child message", time: { created: 0 } }],
  }
  const prompted = Promise.withResolvers<{ sessionID: string; text: string }>()
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: child.id },
    fetch: async (url, request) => {
      const session = [parent, child].find((item) => url.pathname.startsWith(`/api/session/${item.id}`))
      if (url.pathname === "/api/session") return json({ data: [parent, child], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            { id: "build", mode: "primary", hidden: false, permissions: [] },
            { id: "explore", mode: "subagent", hidden: false, permissions: [] },
          ],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (!session) return undefined
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages[session.id], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/agent`) {
        const body = await request.json()
        prompted.resolve({ sessionID: session.id, text: `switched agent to ${body.agent}` })
        return json({ data: session })
      }
      if (url.pathname === `/api/session/${session.id}/prompt`) {
        const body = await request.json()
        prompted.resolve({ sessionID: session.id, text: body.text })
        return json({
          data: {
            id: body.id,
            sessionID: session.id,
            type: "user",
            time: { created: 1 },
            payload: { text: body.text },
          },
        })
      }
      return undefined
    },
  })
  await setup.ready

  // The child opens on its prompt, focused, rather than on the subagent picker.
  expect(
    await setup.waitForFrame((frame) => frame.includes("Child message") && frame.includes("Demo Model")),
  ).not.toContain("Subagents")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor !== null)
  await setup.mockInput.typeText("Follow up")
  setup.mockInput.pressEnter()
  // Sent to the child under its own subagent-mode agent, not switched to the primary one.
  expect(await prompted.promise).toEqual({ sessionID: child.id, text: "Follow up" })

  // Down leaves the empty prompt for the picker, which leads with the parent; up from the top returns to the prompt.
  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => frame.includes("Subagents") && frame.includes("Build: Parent session"))
  setup.mockInput.pressArrow("up")
  expect(await setup.waitForFrame((frame) => !frame.includes("Subagents"))).toContain("Demo Model")
  await setup.waitFor(() => setup.renderer.currentFocusedEditor !== null)

  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => frame.includes("Build: Parent session"))
  setup.mockInput.pressEnter()
  expect(await setup.waitForFrame((frame) => frame.includes("Parent message"))).not.toContain("Subagents")
})
