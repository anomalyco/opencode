import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

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

async function openChild(input: { width?: number; running?: boolean; agent?: string } = {}) {
  const prompted = Promise.withResolvers<{ sessionID: string; text: string }>()
  const interrupted = Promise.withResolvers<string>()
  const setup = await createAppFixture({
    width: input.width ?? 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: child.id, agent: input.agent },
    fetch: async (url, request) => {
      const session = [parent, child].find((item) => url.pathname.startsWith(`/api/session/${item.id}`))
      if (url.pathname === "/api/session") return json({ data: [parent, child], cursor: {} })
      if (url.pathname === "/api/session/active")
        return json({ data: input.running ? { [child.id]: { type: "running" } } : {} })
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
      if (url.pathname === `/api/session/${session.id}/interrupt`) {
        interrupted.resolve(session.id)
        return json({ interrupted: true })
      }
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
  await setup.waitForFrame((frame) => frame.includes("Child message") && frame.includes("Demo Model"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor !== null)
  return Object.assign(setup, { prompted: prompted.promise, interrupted: interrupted.promise })
}

test("a subagent session takes prompts and reaches its parent through the picker", async () => {
  // A launch `--agent` applies to main sessions, not to the subagent opened here.
  await using setup = await openChild({ agent: "build" })

  // The child opens on its prompt, focused, rather than on the subagent picker.
  expect(setup.captureCharFrame()).not.toContain("Subagents")
  await setup.mockInput.typeText("Follow up")
  setup.mockInput.pressEnter()
  // Sent to the child under its own subagent-mode agent, not switched to the primary one.
  expect(await setup.prompted).toEqual({ sessionID: child.id, text: "Follow up" })

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

test.each([100, 50])(
  "a subagent at width %i says where you are, and escape on an empty prompt leaves it",
  async (width) => {
    await using setup = await openChild({ width })
    const wide = width >= 80

    const frame = setup.captureCharFrame()
    // Wide shows the whole trail; narrow keeps the agent whole and shortens the rest.
    expect(frame).toContain(wide ? "Parent session › Explore subagent · Inspect the code" : "Explore subagent · ")
    expect(frame).toContain(wide ? "esc main session" : "esc back")

    // A draft keeps escape on the prompt, so typing never loses its place.
    await setup.mockInput.typeText("draft")
    await setup.waitForFrame((frame) => frame.includes("draft"))
    setup.mockInput.pressEscape()
    await setup.waitForVisualIdle({ quietFrames: 2 })
    expect(setup.captureCharFrame()).toContain("Child message")

    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => !frame.includes("draft"))
    setup.mockInput.pressEscape()
    const parentFrame = await setup.waitForFrame((frame) => frame.includes("Parent message"))
    expect(parentFrame).not.toContain("subagent ·")
  },
)

test("escape in a running subagent interrupts it instead of leaving", async () => {
  await using setup = await openChild({ running: true })

  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => frame.includes("again to interrupt"))
  setup.mockInput.pressEscape()
  expect(await setup.interrupted).toBe(child.id)
  expect(setup.captureCharFrame()).toContain("Child message")
})
