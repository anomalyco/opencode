import { afterEach, beforeEach, expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import path from "node:path"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"

// The home composer saves its draft across fixture instances.
beforeEach(() => void takeDraft(undefined))
afterEach(() => void takeDraft(undefined))

test("popping a shell draft restores shell mode after leaving it", async () => {
  await using setup = await createAppFixture({
    config: { animations: false, keybinds: { "prompt.stash": "f6", "prompt.stash.pop": "f7" } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  const editor = setup.renderer.currentFocusedEditor!

  await setup.mockInput.typeText("!echo hello")
  await setup.waitForFrame((frame) => frame.includes("Shell"))
  setup.mockInput.pressKey("F6")
  expect(editor.plainText).toBe("")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Shell"))
  setup.mockInput.pressKey("F7")

  expect(editor.plainText).toBe("echo hello")
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Shell")
})

test("selecting an older stash without a mode restores it as a regular prompt", async () => {
  await using state = await tmpdir()
  const file = Bun.file(path.join(state.path, "prompt-stash.jsonl"))
  await Bun.write(file, JSON.stringify({ prompt: { text: "describe the project", pasted: [] }, timestamp: 1 }))
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false, keybinds: { "prompt.stash.list": "f8" } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.waitFor(async () => (await file.text()).endsWith("\n"))
  const editor = setup.renderer.currentFocusedEditor!

  await setup.mockInput.typeText("!")
  await setup.waitForFrame((frame) => frame.includes("Shell"))
  setup.mockInput.pressKey("F8")
  await setup.waitForFrame(
    (frame) =>
      frame.includes("describe the project") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEnter()

  expect(editor.plainText).toBe("describe the project")
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Shell")
})
