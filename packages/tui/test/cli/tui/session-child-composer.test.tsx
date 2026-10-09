/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createAppFixture } from "../../fixture/app"
import { tmpdir } from "../../fixture/fixture"
import { directory, json } from "../../fixture/tui-client"

const parent = {
  id: "ses_parent",
  projectID: "proj_test",
  location: { directory },
  title: "Parent",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
}

const child = { ...parent, id: "ses_child", title: "Subagent", parentID: parent.id }

const messages = [{ id: "child-user", type: "user", text: "Child prompt", time: { created: 0 } }]

function fetch(url: URL) {
  if (url.pathname === "/api/session") return json({ data: [parent, child], cursor: {} })
  if (url.pathname === `/api/session/${child.id}`) return json({ data: child })
  if (url.pathname === `/api/session/${parent.id}`) return json({ data: parent })
  if (url.pathname.endsWith("/message")) return json({ data: messages.toReversed(), cursor: {} })
  if (url.pathname.endsWith("/inbox") || url.pathname.endsWith("/permission")) return json({ data: [] })
  return undefined
}

function hiddenConfig() {
  return {
    animations: false,
    tabs: { mode: "off" as const },
    session: { hide_subagents_in_child_sessions: true },
  }
}

test("a child session auto-opens the Subagents card by default", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: child.id },
    config: { animations: false, tabs: { mode: "off" } },
    fetch,
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Subagents"))
  expect(setup.captureCharFrame()).toContain("Subagents")
})

test("hiding subagents in a child session suppresses the card without opening Shell", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: child.id },
    config: hiddenConfig(),
    fetch,
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Child prompt"))
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Subagents")
  expect(frame).not.toContain("No shell commands")

  setup.mockInput.pressArrow("down")
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Subagents")
  expect(setup.captureCharFrame()).not.toContain("No shell commands")
})

test("the terminal picker still opens in a hidden child session", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: child.id },
    config: hiddenConfig(),
    fetch,
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Child prompt"))
  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressArrow("down")
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Terminals")
  expect(frame).toContain("+ New terminal")
  expect(frame).not.toContain("Subagents")
})
