import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1440, height: 900 } })

test("answers /btw in the side panel without admitting a prompt", async ({ page }) => {
  const generations: { sessionID: string; prompt: string }[] = []
  const prompts: unknown[] = []
  const generated = Promise.withResolvers<void>()
  const main = { id: "ses_btw_sidebar", title: "Side question session" }
  const other = { id: "ses_btw_sidebar_other", title: "Other side question session" }
  const { editor } = await openSession(page, {
    name: "BtwSidebar",
    sessions: [main, other],
    onPrompt: (input) => prompts.push(input),
    generate: async (input) => {
      generations.push(input)
      if (input.sessionID === other.id) return { text: "This answer belongs to the **other session**." }
      await generated.promise
      return {
        text: "The retry loop uses **exponential backoff** and stops after three attempts.\n\n```ts\nconst delay = 2 ** attempt\n```",
      }
    },
  })

  await editor.fill("/btw")
  const suggestion = page.locator('[data-suggestion-id="btw.ask"]')
  await expect(suggestion).toBeVisible()
  await suggestion.click()
  await expect(editor).toHaveText("/btw ")
  await editor.press("Enter")

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await expect(panel).toBeHidden()
  await expect(page.getByText("Add a question after /btw", { exact: true })).toBeVisible()
  expect(generations).toEqual([])
  expect(prompts).toEqual([])

  await editor.fill("/btw how does the retry loop work?")
  await editor.press("Enter")
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await expect(panel.getByRole("status")).toContainText("Working")
  await expect(page.getByRole("tab", { name: "/btw" })).toHaveAttribute("data-selected", "")
  generated.resolve()
  await expect(panel.getByText("how does the retry loop work?", { exact: true })).toBeVisible()
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await expect(panel.getByText("const delay = 2 ** attempt", { exact: true })).toBeVisible()
  expect(generations).toHaveLength(1)
  expect(generations[0]?.sessionID).toBe(main.id)
  expect(generations[0]?.prompt).toContain("how does the retry loop work?")
  expect(prompts).toEqual([])
  await expect(editor).toHaveText("")

  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(other.id)}"]`).click()
  await expectSessionTitle(page, other.title)
  await editor.fill("/btw what belongs here?")
  await editor.press("Enter")
  await expect(panel.getByText("other session", { exact: false })).toBeVisible()

  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await expect(panel.getByText("other session", { exact: false })).toHaveCount(0)

  await page.reload()
  await expectSessionTitle(page, main.title)
  await expect(page.getByRole("tab", { name: "/btw" })).toHaveCount(0)
  await expect(panel).toHaveCount(0)
})
