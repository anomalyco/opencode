import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test.each([
  { width: 100, trigger: "/" },
  { width: 44, trigger: "/" },
  { width: 100, trigger: "@" },
  { width: 44, trigger: "@" },
])("autocomplete mode follows its focused editor (%j)", async ({ width, trigger }) => {
  await using setup = await createAppFixture({
    width,
    height: 30,
    config: { animations: false },
    fetch: (url) => {
      if (url.pathname === "/api/fs/find") return json({ location: { directory }, data: [] })
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  const editor = setup.renderer.currentFocusedRenderable as TextareaRenderable
  const length = editor.plainText.length
  for (let i = 0; i < length; i++) setup.mockInput.pressBackspace()
  await setup.waitForFrame((frame) => !frame.includes("/agents") && !frame.includes("No matching files"))
  await setup.mockInput.typeText(trigger)
  await setup.waitForFrame((frame) => frame.includes(trigger === "/" ? "/agents" : "No matching files"))

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
  const remaining = editor.plainText.length
  for (let i = 0; i < remaining; i++) setup.mockInput.pressBackspace()
  await setup.mockInput.typeText(trigger)
  await setup.waitForFrame((frame) => frame.includes(trigger === "/" ? "/agents" : "No matching files"))
  setup.mockInput.pressEscape()
  const dismissed = await setup.waitForFrame(
    (frame) => !frame.includes("/agents") && !frame.includes("No matching files"),
  )
  expect(dismissed).not.toContain(trigger === "/" ? "/agents" : "No matching files")
  setup.mockInput.pressBackspace()
  await setup.waitFor(() => editor.plainText === "")
  setup.mockInput.pressKey("c", { ctrl: true })
  await setup.waitFor(() => setup.renderer.isDestroyed)
  expect(setup.renderer.isDestroyed).toBe(true)
})
