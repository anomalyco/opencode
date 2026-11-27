import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"

async function composerWithShellStash(state: string) {
  takeDraft(undefined)
  const setup = await createAppFixture({
    state,
    config: { animations: false, keybinds: { "prompt.stash": "f6", "prompt.stash.pop": "f7", "prompt.stash.list": "f8" } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("!echo pen")
  await setup.waitForFrame((frame) => frame.includes("Shell"))
  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => !frame.includes("echo pen") && !frame.includes("Shell"))
  return setup
}

test("popping a stashed shell draft restores shell mode", async () => {
  await using state = await tmpdir()
  await using setup = await composerWithShellStash(state.path)

  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("echo pen") && frame.includes("Shell"))
  expect(setup.renderer.currentFocusedEditor!.plainText).toBe("echo pen")
})

test("selecting a stashed shell draft from the stash list restores shell mode", async () => {
  await using state = await tmpdir()
  await using setup = await composerWithShellStash(state.path)

  setup.mockInput.pressKey("F8")
  await setup.waitForFrame(
    (frame) => frame.includes("echo pen") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("echo pen") && frame.includes("Shell"))
  expect(setup.renderer.currentFocusedEditor!.plainText).toBe("echo pen")
})
