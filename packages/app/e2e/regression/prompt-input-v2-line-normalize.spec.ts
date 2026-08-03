import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2LineNormalize"
const projectID = "proj_prompt_input_v2_line_normalize"
const sessionID = "ses_prompt_input_v2_line_normalize"

async function openComposer(page: import("@playwright/test").Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-input-v2-line-normalize",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-input-v2-line-normalize",
        projectID,
        directory,
        title: "Prompt input V2 line normalize",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expectAppVisible(composer)
  return input
}

test("flattens a multi-line draft back into plain text without losing line breaks", async ({ page }) => {
  const input = await openComposer(page)
  await input.click()

  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`)
  await input.evaluate((editor, text) => document.execCommand("insertText", false, text), lines.join("\n") + "\n")

  await expect.poll(() => input.evaluate((editor) => editor.childNodes.length)).toBeLessThanOrEqual(24)
  const text = await input.evaluate((editor) => editor.textContent ?? "")
  expect(text.startsWith(lines.join("\n"))).toBe(true)
})

test("keeps a mention pill intact after a long multi-line draft is flattened", async ({ page }) => {
  const input = await openComposer(page)
  await input.click()

  await input.evaluate((editor) => {
    document.execCommand("insertText", false, "before\n")
    const selection = window.getSelection()
    const range = selection!.getRangeAt(0)
    const mention = document.createElement("span")
    mention.textContent = "@file.ts"
    mention.contentEditable = "false"
    mention.dataset.mention = "file"
    mention.dataset.path = "src/file.ts"
    range.insertNode(mention)
    range.setStartAfter(mention)
    range.collapse(true)
    selection!.removeAllRanges()
    selection!.addRange(range)
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }))
  })

  const filler = Array.from({ length: 30 }, (_, i) => `after ${i}`).join("\n")
  await input.evaluate((editor, text) => document.execCommand("insertText", false, text), filler)

  await expect.poll(() => input.evaluate((editor) => editor.childNodes.length)).toBeLessThanOrEqual(24)
  const mention = input.locator('[data-mention="file"]')
  await expect(mention).toHaveAttribute("data-path", "src/file.ts")
  await expect(mention).toHaveText("@file.ts")
})
