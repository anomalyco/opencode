import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"

test.each([
  { key: "left", code: "57417", modifier: 1, start: 22, end: 21 },
  { key: "right", code: "57418", modifier: 1, start: 0, end: 1 },
  { key: "ctrl+left", code: "57417", modifier: 5, start: 22, end: 17 },
  { key: "ctrl+right", code: "57418", modifier: 5, start: 0, end: 6 },
  { key: "alt+left", code: "57417", modifier: 3, start: 22, end: 17 },
  { key: "alt+right", code: "57418", modifier: 3, start: 0, end: 6 },
])("the prompt handles keypad $key", async (input) => {
  takeDraft(undefined)
  await using setup = await createAppFixture({ width: 100, height: 30 })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = setup.renderer.currentFocusedEditor
  if (!(prompt instanceof TextareaRenderable)) throw new Error("expected the focused prompt textarea")
  const text = "alpha beta gamma delta"
  await setup.mockInput.typeText(text)
  prompt.cursorOffset = input.start

  setup.mockInput.pressKey(input.code === "57417" ? "ARROW_LEFT" : "ARROW_RIGHT", {
    ctrl: input.modifier === 5,
    meta: input.modifier === 3,
  })
  await setup.renderOnce()
  expect(prompt.cursorOffset).toBe(input.end)
  prompt.cursorOffset = input.start

  // Feed the terminal's kitty keypad sequence through the real input parser and keymap.
  setup.renderer.stdin.emit("data", Buffer.from(`\x1b[${input.code};${input.modifier}u`))
  await setup.renderOnce()
  expect(prompt.cursorOffset).toBe(input.end)
  await setup.mockInput.typeText("X")
  expect(prompt.plainText).toBe(`${text.slice(0, input.end)}X${text.slice(input.end)}`)
})

test("custom prompt word bindings replace the keypad defaults", async () => {
  takeDraft(undefined)
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, keybinds: { "input.word.backward": "ctrl+y" } },
  })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = setup.renderer.currentFocusedEditor
  if (!(prompt instanceof TextareaRenderable)) throw new Error("expected the focused prompt textarea")
  await setup.mockInput.typeText("alpha beta gamma delta")

  setup.renderer.stdin.emit("data", Buffer.from("\x1b[57417;5u"))
  await setup.renderOnce()
  expect(prompt.cursorOffset).toBe(22)
  setup.mockInput.pressKey("y", { ctrl: true })
  await setup.renderOnce()
  expect(prompt.cursorOffset).toBe(17)
})

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
