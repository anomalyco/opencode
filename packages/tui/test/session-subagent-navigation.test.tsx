import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { session } from "./fixture/local"
import { directory, json } from "./fixture/tui-client"

test("Down moves through a multi-line prompt before opening the subagent picker when history is unbound", async () => {
  const active = session("ses_prompt_down")
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: active.id },
    config: {
      animations: false,
      tabs: { mode: "off" },
      keybinds: { "prompt.history.next": "none", "prompt.history.previous": "none" },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [active], cursor: {} })
      if (url.pathname === `/api/session/${active.id}`) return json({ data: active })
      if (url.pathname === `/api/session/${active.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${active.id}/inbox`) return json({ data: [] })
    },
  })
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = setup.renderer.currentFocusedEditor
  if (!(prompt instanceof TextareaRenderable)) throw new Error("Missing focused prompt")
  prompt.setText("first line\nsecond line\nthird line")
  prompt.cursorOffset = 0
  await setup.renderOnce()

  setup.mockInput.pressArrow("down")
  await setup.renderOnce()
  expect(setup.renderer.currentFocusedEditor).toBe(prompt)
  expect(prompt.cursorOffset).toBe("first line\n".length)

  setup.mockInput.pressArrow("down")
  await setup.renderOnce()
  expect(setup.renderer.currentFocusedEditor).toBe(prompt)
  expect(prompt.cursorOffset).toBe("first line\nsecond line\n".length)

  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => setup.renderer.currentFocusedEditor !== prompt && frame.includes("Subagents"))
})

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

test("displays form question when viewing a subagent session with pending forms", async () => {
  const session = {
    id: "ses_subagent_form",
    parentID: "ses_parent",
    title: "Subagent Task",
    agent: "general",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const form = {
    id: "frm_subagent_q",
    sessionID: session.id,
    title: "Question from subagent",
    fields: [
      {
        key: "choice",
        type: "string",
        title: "Proceed with operation?",
        options: [{ value: "yes", label: "Yes" }],
      },
    ],
  }
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/form`) return json({ data: [form] })
    },
  })
  await setup.ready
  const frame = await setup.waitForFrame((frame) => frame.includes("Question from subagent"))
  expect(frame).toContain("Question from subagent")
})

test("displays nested subagent permission prompt when viewing an intermediate subagent session", async () => {
  const session = {
    id: "ses_subagent_intermediate",
    parentID: "ses_parent",
    title: "Subagent Task",
    agent: "general",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const grandchild = {
    id: "ses_grandchild",
    parentID: session.id,
    title: "Grandchild Task",
    agent: "general",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
  const request = {
    id: "per_grandchild_cmd",
    sessionID: grandchild.id,
    action: "shell",
    resources: ["pytest -q"],
    save: ["pytest *"],
  }
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session, grandchild], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${grandchild.id}`) return json({ data: grandchild })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
      if (url.pathname === `/api/session/${grandchild.id}/permission`) return json({ data: [request] })
    },
  })
  await setup.ready
  const frame = await setup.waitForFrame((frame) => frame.includes("Permission required"))
  expect(frame).toContain("Permission required")
  expect(frame).toContain("pytest -q")
})
