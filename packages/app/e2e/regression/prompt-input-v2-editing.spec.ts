import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2Editing"
const projectID = "proj_prompt_input_v2_editing"
const sessionID = "ses_prompt_input_v2_editing"

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-input-v2-editing",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: { test: { id: "test", name: "Test Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["anthropic"],
      default: { providerID: "anthropic", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-input-v2-editing",
        projectID,
        directory,
        title: "Prompt input V2 editing",
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
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))
})

test("does not save the start of a Mod+A selection as the caret", async ({ page }) => {
  const editor = page.locator('[data-component="prompt-input-v2"] [data-component="prompt-input"]')
  const text = "select all of this text"
  await editor.fill(text)
  await editor.press("Meta+a")
  await page.getByRole("button", { name: "Test Model" }).click()
  const search = page.getByPlaceholder("Search models")
  await expect(search).toBeVisible()
  await search.press("Escape")

  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const selection = window.getSelection()
        if (!selection?.isCollapsed || !element.contains(selection.anchorNode)) return -1
        const range = selection.getRangeAt(0).cloneRange()
        range.selectNodeContents(element)
        range.setEnd(selection.anchorNode!, selection.anchorOffset)
        return range.toString().length
      }),
    )
    .toBe(text.length)
})

test("pastes rich clipboard content as plain text", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const editor = page.locator('[data-component="prompt-input-v2"] [data-component="prompt-input"]')
  await editor.focus()
  await page.evaluate(async () => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob(["<strong>formatted</strong> <a href='https://example.com'>text</a>"], {
          type: "text/html",
        }),
        "text/plain": new Blob(["formatted text"], { type: "text/plain" }),
      }),
    ])
  })
  await editor.press("Meta+v")

  await expect(editor).toHaveText("formatted text")
  expect(await editor.locator("strong, a").count()).toBe(0)
})
