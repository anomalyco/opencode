import { expect, test } from "bun:test"
import path from "node:path"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"

async function composerWithHistory(state: string) {
  takeDraft(undefined)
  const file = path.join(state, "prompt-history.jsonl")
  // Matching the oldest entry lets Up recall "previous" even before the draft restoration fix.
  const entries = ["echo pen", "previous"].map((text) => JSON.stringify({ text, mode: "normal", pasted: [] }))
  await Bun.write(file, entries.join("\n"))
  const setup = await createAppFixture({ state })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  // Loading history rewrites the file with a trailing newline.
  await setup.waitFor(async () => (await Bun.file(file).text()).endsWith("\n"))
  return setup
}

test("down past the newest entry restores the draft text and shell mode", async () => {
  await using state = await tmpdir()
  await using setup = await composerWithHistory(state.path)
  const editor = setup.renderer.currentFocusedEditor!

  await setup.mockInput.typeText("!echo pen")
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressArrow("up")
  expect(editor.plainText).toBe("previous")
  await setup.waitForFrame((frame) => frame.includes("previous") && !frame.includes("Shell"))

  setup.mockInput.pressKey("END")
  setup.mockInput.pressArrow("down")
  expect(editor.plainText).toBe("echo pen")
  await setup.waitForFrame((frame) => frame.includes("Shell"))
})

test("clearing a recalled entry drops the draft so down stays empty", async () => {
  await using state = await tmpdir()
  await using setup = await composerWithHistory(state.path)
  const editor = setup.renderer.currentFocusedEditor!

  await setup.mockInput.typeText("unsent")
  setup.mockInput.pressKey("HOME")
  setup.mockInput.pressArrow("up")
  expect(editor.plainText).toBe("previous")

  setup.mockInput.pressKey("c", { ctrl: true })
  expect(editor.plainText).toBe("")
  setup.mockInput.pressArrow("down")
  expect(editor.plainText).toBe("")
})
