import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import type { Config } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { session } from "./fixture/local"
import { directory, json } from "./fixture/tui-client"

test("Down moves through a multiline prompt before opening the subagent picker with history disabled", async () => {
  await using setup = await createPromptFixture()
  const prompt = await fillMultilinePrompt(setup)

  setup.mockInput.pressArrow("down")
  expect(setup.renderer.currentFocusedEditor).toBe(prompt)
  expect(prompt.cursorOffset).toBe("First line\n".length)

  setup.mockInput.pressArrow("down")
  expect(setup.renderer.currentFocusedEditor).toBe(prompt)
  expect(prompt.cursorOffset).toBe("First line\nSecond line\n".length)

  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => setup.renderer.currentFocusedEditor !== prompt && frame.includes("Subagents"))
})

test("Down opens the subagent picker from the middle of a prompt when cursor movement uses another key", async () => {
  await using setup = await createPromptFixture({ "input.move.down": "ctrl+n" })
  const prompt = await fillMultilinePrompt(setup)

  setup.mockInput.pressKey("n", { ctrl: true })
  expect(prompt.cursorOffset).toBe("First line\n".length)

  setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => setup.renderer.currentFocusedEditor !== prompt && frame.includes("Subagents"))
})

async function createPromptFixture(keybinds?: Config.Info["keybinds"]) {
  const active = session("ses_prompt_arrow")
  return createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: active.id },
    config: {
      animations: false,
      tabs: { mode: "off" },
      keybinds: { "prompt.history.next": "none", "prompt.history.previous": "none", ...keybinds },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [active], cursor: {} })
      if (url.pathname === `/api/session/${active.id}`) return json({ data: active })
      if (url.pathname === `/api/session/${active.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${active.id}/inbox`) return json({ data: [] })
    },
  })
}

async function fillMultilinePrompt(setup: Awaited<ReturnType<typeof createPromptFixture>>) {
  await setup.ready
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = setup.renderer.currentFocusedEditor
  if (!(prompt instanceof TextareaRenderable)) throw new Error("Missing focused session prompt")
  prompt.setText("First line\nSecond line\nThird line")
  prompt.cursorOffset = 0
  await setup.renderOnce()
  return prompt
}

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
