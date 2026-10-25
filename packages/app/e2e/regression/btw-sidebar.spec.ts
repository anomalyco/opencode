import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1440, height: 900 } })

test("keeps separate one-shot /btw answers and restores them after reload", async ({ page }, testInfo) => {
  const prompts: unknown[] = []
  const generations: { sessionID: string; prompt: string }[] = []

  const { editor } = await openSession(page, {
    name: "BtwQuestions",
    onPrompt: (input) => prompts.push(input),
    generate: (input) => {
      generations.push(input)

      return {
        text: input.prompt.includes("second question")
          ? "Second answer"
          : `First answer\n\n${"A detailed explanation of the first question.\n\n".repeat(100)}End of first answer`,
      }
    },
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await editor.fill("/btw first question")
  await editor.press("Enter")
  await expect(panel.getByText("First answer", { exact: true })).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toHaveCount(0)
  await panel.getByText("End of first answer", { exact: true }).scrollIntoViewIfNeeded()
  await expect(panel.getByText("End of first answer", { exact: true })).toBeInViewport()
  await editor.fill("/btw second question")
  await editor.press("Enter")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  const first = page.getByRole("tab", { name: "first question", exact: true })
  const second = page.getByRole("tab", { name: "second question", exact: true })
  await expect(first).toBeVisible()
  await expect(second).toHaveAttribute("data-selected", "")
  await page.screenshot({ path: testInfo.outputPath("separate-tabs.png") })
  expect(generations).toHaveLength(2)
  expect(generations[1]?.prompt).not.toContain("first question")
  expect(generations[1]?.prompt).not.toContain("First answer")

  await page.reload()
  await expect(first).toBeVisible()
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  await first.click()
  await expect(panel.getByText("First answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("Second answer", { exact: true })).toHaveCount(0)
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("restored-answer.png") })

  // Closing a tab forgets its question; the other tab and its answer survive a reload.
  await first.click({ button: "middle" })
  await expect(first).toHaveCount(0)
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  await page.reload()
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  await expect(first).toHaveCount(0)
  expect(generations).toHaveLength(2)
  expect(prompts).toEqual([])
})

test("isolates concurrent side questions and makes an interrupted reload retryable", async ({ page }) => {
  const held = Promise.withResolvers<void>()
  const attempts: string[] = []
  const prompts: unknown[] = []

  const { editor } = await openSession(page, {
    name: "BtwConcurrent",
    onPrompt: (input) => prompts.push(input),
    generate: async (input) => {
      attempts.push(input.prompt)

      if (input.prompt.includes("slow question") && attempts.length === 1) {
        await held.promise

        return { text: "Abandoned answer" }
      }

      return { text: input.prompt.includes("fast question") ? "Fast answer" : "Retried answer" }
    },
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await editor.fill("/btw slow question")
  await editor.press("Enter")
  await expect(panel.getByRole("status")).toContainText("Working")
  await editor.fill("/btw fast question")
  await editor.press("Enter")
  await expect(panel.getByText("Fast answer", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "slow question", exact: true }).click()
  await expect(panel.getByRole("status")).toContainText("Working")
  await expect(panel.getByText("Fast answer", { exact: true })).toHaveCount(0)

  await page.reload()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toBeVisible()
  await expect(panel.getByRole("status")).toHaveCount(0)
  expect(attempts).toHaveLength(2)
  await panel.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(panel.getByText("Retried answer", { exact: true })).toBeVisible()
  expect(attempts).toHaveLength(3)
  expect(attempts[2]).toContain("slow question")
  expect(attempts[2]).not.toContain("fast question")
  held.resolve()
  await page.getByRole("tab", { name: "fast question", exact: true }).click()
  await expect(panel.getByText("Fast answer", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "slow question", exact: true }).click()
  await expect(panel.getByText("Retried answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("Abandoned answer", { exact: true })).toHaveCount(0)
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  expect(prompts).toEqual([])
})

test("keeps many long-titled side tabs usable at a narrow desktop width", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 })

  const { editor } = await openSession(page, {
    name: "BtwOverflow",
    generate: () => ({ text: "Saved overflow answer" }),
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  const questions = Array.from({ length: 12 }, (_, index) => `Side ${index + 1}: ${"long-title-".repeat(30)}`)

  for (const question of questions) {
    await editor.fill(`/btw ${question}`)
    await editor.press("Enter")
    await expect(page.getByRole("tab", { name: question, exact: true })).toHaveAttribute("data-selected", "")
    await expect(panel.getByText("Saved overflow answer", { exact: true })).toBeVisible()
  }

  await expect(page.getByRole("tab", { name: /^Side \d+:/ })).toHaveCount(12)
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("tab", { name: /^Side \d+:/ })).toHaveCount(12)
  await expect(panel.getByText("Saved overflow answer", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("narrow-many-tabs.png") })
})

test("answers /btw in the side panel without admitting a prompt", async ({ page }) => {
  const generations: { sessionID: string; prompt: string }[] = []
  const prompts: unknown[] = []
  const generated = Promise.withResolvers<void>()
  const leftBehind = Promise.withResolvers<void>()
  const main = { id: "ses_btw_sidebar", title: "Side question session" }
  const other = { id: "ses_btw_sidebar_other", title: "Other side question session" }
  const ownerWarnings: string[] = []
  page.on("console", (message) => {
    if (message.text().includes("computations created outside a `createRoot` or `render`"))
      ownerWarnings.push(message.text())
  })

  const { editor } = await openSession(page, {
    name: "BtwSidebar",
    sessions: [main, other],
    onPrompt: (input) => prompts.push(input),
    generate: async (input) => {
      generations.push(input)

      if (input.sessionID === other.id) return { text: "This answer belongs to the **other session**." }

      if (input.prompt.includes("left behind")) {
        await leftBehind.promise

        return { text: "This answer arrived after the user left." }
      }

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
  await expect(page.getByRole("tab", { name: "how does the retry loop work?", exact: true })).toHaveAttribute(
    "data-selected",
    "",
  )
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

  await editor.fill("/btw is this question left behind?")
  await editor.press("Enter")
  await expect(panel.getByRole("status")).toContainText("Working")
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(other.id)}"]`).click()
  await expectSessionTitle(page, other.title)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  // Leaving the session does not abandon its question: it is still working, and its answer lands once it arrives.
  await expect(panel.getByRole("status")).toContainText("Working")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  leftBehind.resolve()
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  await expect(panel.getByText("This answer arrived after the user left.", { exact: true })).toBeVisible()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toHaveCount(0)
  expect(generations.filter((item) => item.prompt.includes("left behind"))).toHaveLength(1)

  await page.reload()
  await expectSessionTitle(page, main.title)
  await expect(page.getByRole("tab", { name: "is this question left behind?", exact: true })).toHaveAttribute(
    "data-selected",
    "",
  )
  await expect(panel.getByText("This answer arrived after the user left.", { exact: true })).toBeVisible()
  await expect(panel.getByRole("status")).toHaveCount(0)
  await page.getByRole("tab", { name: "how does the retry loop work?", exact: true }).click()
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  await expect(page.getByRole("tab", { name: "how does the retry loop work?", exact: true })).toHaveAttribute(
    "data-selected",
    "",
  )
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  expect(ownerWarnings).toEqual([])
})
