import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test("autocomplete mode follows its focused editor", async () => {
  await using setup = await createAppFixture({ width: 100, height: 30, config: { animations: false } })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  const editor = setup.renderer.currentFocusedRenderable as TextareaRenderable
  await setup.mockInput.typeText("/")
  await setup.waitForFrame((frame) => frame.includes("/agents"))

  const other = new InputRenderable(setup.renderer, { id: "other-editor" })
  setup.renderer.root.add(other)
  other.focus()
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === other)
  setup.mockInput.pressKey("p", { ctrl: true })
  const frame = await setup.waitForFrame((frame) => frame.includes("Commands"))
  expect(frame).toContain("Commands")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Commands"))

  editor.focus()
  await setup.waitFor(() => setup.renderer.currentFocusedRenderable === editor)
})
