import type { Locator, Page } from "@playwright/test"

/** The screen of one terminal in the terminal panel; cached terminals of other tabs stay mounted but hidden. */
export function terminalScreen(page: Page, ptyID: string) {
  return page.locator(`#terminal-wrapper-${ptyID} [data-component="terminal"]`)
}

/**
 * The terminal's text as the user can copy it: drags across its canvas and copies with Ctrl+Shift+C. Needs the
 * clipboard permissions. The drag is a pointerdown, so the terminal also takes control, as a click would.
 */
export async function terminalText(page: Page, screen: Locator) {
  const box = await screen.locator("canvas").boundingBox()

  if (!box) throw new Error("The terminal has no canvas")

  // An empty selection copies nothing, so an earlier copy must not pass for the screen.
  await page.evaluate(() => navigator.clipboard.writeText(""))
  await page.mouse.move(box.x + 1, box.y + 1)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.press("Control+Shift+C")
  const text = await page.evaluate(() => navigator.clipboard.readText())

  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}
