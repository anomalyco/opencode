import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"

test("the prompt keeps a cursor style set on its textarea when the theme changes", async () => {
  // Other app tests can leave a home draft in the process-wide stash.
  takeDraft(undefined)
  await using setup = await createAppFixture({
    config: { animations: false, keybinds: { "theme.switch_mode": "f6" } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  const prompt = setup.renderer.currentFocusedEditor
  if (!(prompt instanceof TextareaRenderable)) throw new Error("expected the focused prompt textarea")
  const color = prompt.cursorColor

  // A plugin such as a modal editing mode restyles the prompt cursor directly.
  prompt.cursorStyle = { style: "line", blinking: false }
  setup.mockInput.pressKey("F6")
  await setup.renderOnce()
  await Bun.sleep(10)
  await setup.renderOnce()

  expect(prompt.cursorColor).not.toEqual(color)
  expect(prompt.cursorStyle).toMatchObject({ style: "line", blinking: false })
})
