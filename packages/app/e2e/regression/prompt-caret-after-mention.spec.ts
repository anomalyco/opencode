import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

// Family of #37037 / #36210: the caret position in the prompt input must survive
// external prompt edits. In the v2 composer, inserting a @mention mid-text used to
// rebuild the editor DOM and collapse the caret to the END of the prompt, discarding
// the stored cursor position.

async function editorCursorOffset(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector('[data-component="prompt-input"]')
    if (!(editor instanceof HTMLElement)) throw new Error("editor not found")
    const selection = window.getSelection()
    if (!selection?.rangeCount) throw new Error("no selection")
    const range = selection.getRangeAt(0).cloneRange()
    range.selectNodeContents(editor)
    range.setEnd(selection.anchorNode!, selection.anchorOffset)
    return range.toString().length
  })
}

test("keeps the caret right after a mention inserted mid-prompt", async ({ page }) => {
  test.setTimeout(240_000)
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    findFiles: () => ["src/index.ts"],
  })
  await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.targetID}`)

  const editor = page.getByRole("textbox", { name: "Prompt" })
  await expectAppVisible(editor)
  await editor.click()
  await page.keyboard.type("please fix the bug")
  await page.evaluate(() => {
    const el = document.querySelector('[data-component="prompt-input"]')
    el?.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    range.setStart(el?.firstChild!, 7)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
  await page.keyboard.type("@src")

  const suggestion = page.locator('[data-suggestion-id="file:src/index.ts"]')
  await expect(suggestion).toBeVisible()
  await suggestion.click()
  await page.waitForTimeout(100)

  const text = await page.evaluate(
    () => document.querySelector('[data-component="prompt-input"]')?.textContent ?? "",
  )
  // "please " (7) + "@src/index.ts" (13) + " fix the bug" (12) = 33 chars
  expect(text).toBe("please @src/index.ts fix the bug")
  // The caret must sit right after the mention (7 + 13 + 1 trailing space = 21),
  // not at the end of the whole prompt (33).
  expect(await editorCursorOffset(page)).toBe(21)
})
