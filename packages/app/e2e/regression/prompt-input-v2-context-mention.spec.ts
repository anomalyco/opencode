import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2ContextMention"
const projectID = "proj_prompt_input_v2_context_mention"
const sessionID = "ses_prompt_input_v2_context_mention"

// Reproduces: opening the "@ context" menu (plus button -> Context) rebuilds the
// prompt via setText(promptText + "@"), which drops mention content and moves all
// mention chips to the end, silently rewriting the draft.
test("keeps existing mentions in place when the context menu opens", async ({ page }) => {
  test.setTimeout(240_000)
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-input-v2-context-mention",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-input-v2-context-mention",
        projectID,
        directory,
        title: "Prompt input V2 context mention",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    findFiles: () => ["src/index.ts"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expectAppVisible(composer)

  // Build a draft with two mentions separated by text: "hi @src/index.ts and @src/index.ts"
  await input.click()
  await page.keyboard.type("hi ")
  await page.keyboard.type("@src")
  await page.locator('[data-suggestion-id="file:src/index.ts"]').click()
  await page.waitForTimeout(100)
  await page.keyboard.type(" and ")
  await page.keyboard.type("@src")
  await page.locator('[data-suggestion-id="file:src/index.ts"]').click()
  await page.waitForTimeout(100)

  const editorText = () =>
    page.evaluate(() => document.querySelector('[data-component="prompt-input"]')?.textContent ?? "")

  // Open the context menu via the plus button (this is the bug trigger).
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Context" }).click()
  await page.waitForTimeout(100)

  const after = await editorText()

  // The two mentions keep their order and "and" stays between them; only a
  // trailing "@" is appended at the caret. The old bug rewrote the draft so both
  // mention chips collapsed to the end (e.g. "hi   and  @@src/index.ts@src/index.ts").
  const firstMention = after.indexOf("@src/index.ts")
  const secondMention = after.lastIndexOf("@src/index.ts")
  const andPosition = after.indexOf("and")
  expect(firstMention).not.toBe(-1)
  expect(secondMention).toBeGreaterThan(firstMention)
  expect(andPosition).toBeGreaterThan(firstMention)
  expect(andPosition).toBeLessThan(secondMention)
  expect(after.endsWith("@")).toBe(true)
})
