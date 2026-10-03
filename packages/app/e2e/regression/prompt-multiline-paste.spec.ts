import { expect, test, type Locator } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

const multiline =
  "Move these folders\nD:\\Example\\OCR\\\nD:\\Example\\Transcribe\\\n\n\nTo here\nD:\\Example\\Tools\\OCR\\\n\nUpdate the scripts.\n"

async function paste(editor: Locator, text: string) {
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/plain", text)
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))
  }, text)
}

async function expectText(editor: Locator, text: string) {
  await expect.poll(async () => (await editor.innerText()).replace(/\u200b/g, "")).toBe(text)
}

test.beforeEach(async ({ page }) => {
  await setupTimeline(page, { settings: { newLayoutDesigns: true } })
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
})

for (const lineEnding of ["\n", "\r\n", "\r"]) {
  test(`keeps blank lines after ${JSON.stringify(lineEnding)} paste and returning to the draft`, async ({ page }) => {
    const previous = page.url()
    await page.keyboard.press("ControlOrMeta+Shift+S")
    await expect(page).not.toHaveURL(previous)
    const draft = page.url()
    const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(editor).toBeEditable()
    await editor.focus()
    await paste(editor, multiline.replace(/\n/g, lineEnding))
    await expectText(editor, multiline)
    await page.goBack()
    await expect(page).toHaveURL(previous)
    await expectText(editor, "")
    await page.goForward()
    await expect(page).toHaveURL(draft)
    await expectText(editor, multiline)
    await editor.pressSequentially("Continue")
    await expectText(editor, `${multiline}Continue`)
  })
}

for (const placement of ["empty", "append", "replace"] as const) {
  for (const content of [
    "First line\n\nSecond line",
    "\n\n  first\tline\r\n\r\nsecond\r\n\r\n",
    'literal <b>bold</b> &amp; & < > "quotes"\n<script>not code</script>\n<img src="example">',
  ]) {
    test(`keeps undo/redo and the caret for ${placement}: ${JSON.stringify(content)}`, async ({ page }) => {
      const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
      await editor.focus()
      const initial = placement === "empty" ? "" : placement === "append" ? "Before" : "Before REMOVE after"
      if (initial) await editor.pressSequentially(initial)
      if (placement === "replace") {
        await editor.press("ControlOrMeta+Home")
        for (let index = 0; index < "Before ".length; index++) await editor.press("ArrowRight")
        for (let index = 0; index < "REMOVE".length; index++) await editor.press("Shift+ArrowRight")
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("REMOVE")
      }
      await paste(editor, content)
      const normalized = content.replace(/\r\n?/g, "\n")
      const expected = placement === "replace" ? `Before ${normalized} after` : `${initial}${normalized}`
      await expectText(editor, expected)
      await expect(editor.locator("b, script, img")).toHaveCount(0)
      await editor.press("ControlOrMeta+Z")
      await expectText(editor, initial)
      await editor.press("ControlOrMeta+Shift+Z")
      await expectText(editor, expected)
      await editor.pressSequentially("!")
      await expectText(editor, placement === "replace" ? `Before ${normalized}! after` : `${expected}!`)
    })
  }
}

test("pastes in the middle and undoes two pastes independently", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
  await editor.focus()
  await editor.pressSequentially("Before after")
  await editor.press("ControlOrMeta+Home")
  for (let index = 0; index < "Before ".length; index++) await editor.press("ArrowRight")
  await paste(editor, "one\n\ntwo")
  await expectText(editor, "Before one\n\ntwoafter")
  await paste(editor, "\nthree\nfour")
  await expectText(editor, "Before one\n\ntwo\nthree\nfourafter")
  await editor.press("ControlOrMeta+Z")
  await expectText(editor, "Before one\n\ntwoafter")
  await editor.press("ControlOrMeta+Z")
  await expectText(editor, "Before after")
  await editor.press("ControlOrMeta+Shift+Z")
  await expectText(editor, "Before one\n\ntwoafter")
  await editor.press("ControlOrMeta+Shift+Z")
  await expectText(editor, "Before one\n\ntwo\nthree\nfourafter")
})

test("preserves single-line text and native undo/redo", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
  await editor.focus()
  await paste(editor, "literal <b> &amp;")
  await expectText(editor, "literal <b> &amp;")
  await expect(editor.locator("b")).toHaveCount(0)
  await editor.press("ControlOrMeta+Z")
  await expectText(editor, "")
  await editor.press("ControlOrMeta+Shift+Z")
  await expectText(editor, "literal <b> &amp;")
})
