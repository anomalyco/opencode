import { expect, test } from "bun:test"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { takeDraft } from "../../../src/component/prompt/draft-stash"
import { getOpenCodeTheme } from "../../../src/theme"
import { createAppFixture } from "../../fixture/app"

const theme = resolveThemeDocument(getOpenCodeTheme(), "dark")

// The popup's left edge: the first rail cell on each line that shows `text`.
async function railColors(newDesigns: boolean, keys: (setup: Awaited<ReturnType<typeof createAppFixture>>) => void) {
  // The home composer stashes its draft at module scope on unmount; drop the previous test's "/c".
  takeDraft(undefined)
  await using setup = await createAppFixture({
    config: { animations: false, tabs: { mode: "off" }, experimental: { "new-designs": newDesigns } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("/c")
  await setup.waitForFrame((frame) => frame.includes("Change working directory"))
  keys(setup)
  await setup.renderOnce()
  return Object.fromEntries(
    setup.renderer.currentRenderBuffer
      .getSpanLines()
      .map((line) => line.spans.map((span) => span.text).join(""))
      .flatMap((text, index) => {
        const name = text.match(/┃ (\/\S+)/)?.[1]
        if (!name) return []
        const rail = setup.renderer.currentRenderBuffer.getSpanLines()[index]!.spans.find((span) => span.text === "┃")!
        return [[name, rail.fg.toInts()]]
      }),
  )
}

test("marks the selected composer suggestion on the left rail under new designs", async () => {
  const colors = await railColors(true, (setup) => setup.mockInput.pressArrow("down"))
  const selected = Object.entries(colors).filter(
    ([, color]) => !color.every((c, i) => c === theme.border.base.toInts()[i]),
  )
  expect(selected).toEqual([["/clear", theme.text.formfield.focused.toInts()]])
})

test("keeps a plain left border on composer suggestions in the classic design", async () => {
  const colors = await railColors(false, (setup) => setup.mockInput.pressArrow("down"))
  expect(Object.keys(colors)).toContain("/clear")
  expect(new Set(Object.values(colors).map((color) => color.join()))).toEqual(
    new Set([theme.border.base.toInts().join()]),
  )
})
