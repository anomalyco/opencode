import { TextareaRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"

test("keypad arrows navigate prompt text and history", async () => {
  takeDraft(undefined)
  await using state = await tmpdir()
  const file = path.join(state.path, "prompt-history.jsonl")
  await Bun.write(file, JSON.stringify({ text: "previous", pasted: [] }))
  await using setup = await createAppFixture({ width: 100, height: 30, state: state.path })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
  // Loading history rewrites the file with a trailing newline.
  await setup.waitFor(async () => (await Bun.file(file).text()).endsWith("\n"))
  const prompt = setup.renderer.currentFocusedEditor
  if (!(prompt instanceof TextareaRenderable)) throw new Error("expected the focused prompt textarea")
  const text = "alpha beta gamma delta\nsecond line"
  await setup.mockInput.pasteBracketedText(text)
  await setup.renderOnce()

  for (const input of [
    { sequence: "\x1b[57417u", start: 22, end: 21 },
    { sequence: "\x1b[57418u", start: 0, end: 1 },
    { sequence: "\x1b[57417;5u", start: 22, end: 17 },
    { sequence: "\x1b[57418;5u", start: 0, end: 6 },
    { sequence: "\x1b[57417;3u", start: 22, end: 17 },
    { sequence: "\x1b[57418;3u", start: 0, end: 6 },
    { sequence: "\x1b[57419u", start: 29, end: 6 },
    { sequence: "\x1b[57420u", start: 6, end: 29 },
  ]) {
    prompt.cursorOffset = input.start
    // Feed Kitty keypad sequences through the real input parser and keymap.
    setup.renderer.stdin.emit("data", Buffer.from(input.sequence))
    await setup.renderOnce()
    expect(prompt.cursorOffset, input.sequence).toBe(input.end)
  }

  prompt.cursorOffset = 0
  setup.renderer.stdin.emit("data", Buffer.from("\x1b[57419u"))
  expect(prompt.plainText).toBe("previous")
  prompt.cursorOffset = prompt.plainText.length
  setup.renderer.stdin.emit("data", Buffer.from("\x1b[57420u"))
  expect(prompt.plainText).toBe(text)
  expect(prompt.cursorOffset).toBe(text.length)
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
