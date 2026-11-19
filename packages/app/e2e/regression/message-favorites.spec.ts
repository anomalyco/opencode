import { expect, test } from "@playwright/test"
import { assistantID, assistantMessage, setupTimeline, textPart, userID, userMessage } from "../utils/timeline"
import { openUserMessageMenu } from "../utils/timeline"

test("favorites a prompt and an answer, then jumps from the list", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        textPart(
          "prt_favorite_answer",
          `The answer worth keeping. ${"It needs enough lines to push the prompt out of view. ".repeat(80)}`,
        ),
      ]),
    ],
  })

  // The response actions only paint while their reply is hovered.
  const assistant = page.locator(`[data-timeline-part-id="${assistantID}:text:0"]`)
  const footer = assistant.locator('[data-slot="text-part-copy-wrapper"]')
  await assistant.hover()
  await footer.screenshot({ path: test.info().outputPath("favorite-toggle-before.png"), animations: "disabled" })
  await assistant.getByRole("button", { name: "Add to favorites", exact: true }).click()
  await expect(assistant.getByRole("button", { name: "Remove from favorites", exact: true })).toBeVisible()
  await footer.screenshot({ path: test.info().outputPath("favorite-toggle-after.png"), animations: "disabled" })

  const userRow = page.locator(`[data-timeline-row="UserMessage"][data-message-id="${userID}"]`)
  const menu = await openUserMessageMenu(page, userRow)
  await menu.getByRole("menuitem", { name: "Add to favorites", exact: true }).click()

  // The assistant favorite keeps the prompt row as its anchor, because the timeline cannot scroll to an answer.
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("opencode.global.dat:session.favorites") ?? "null")?.messages?.length,
      ),
    )
    .toBe(2)

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("opencode.global.dat:session.favorites") ?? "null"),
  )
  expect(stored.messages.find((message: { messageID: string }) => message.messageID === assistantID).anchorID).toBe(
    userID,
  )

  // Scroll away from the prompt first, so the jump has somewhere to land.
  const scroller = page.getByRole("region", { name: "scrollable content" })
  await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(userRow).not.toBeInViewport()

  const openFavorites = async () => {
    await page.locator("[data-session-title]").getByRole("button", { name: "More options", exact: true }).click()
    await page.getByRole("menuitem", { name: "Favorite messages…", exact: true }).click()

    const dialog = page.getByRole("dialog", { name: "Favorite messages", exact: true })
    await expect(dialog).toBeVisible()

    return dialog
  }

  const dialog = await openFavorites()
  await expect(dialog.getByRole("option").filter({ hasText: "The answer worth keeping" })).toBeVisible()
  await expect(dialog.getByRole("option").filter({ hasText: "Build the timeline stability matrix" })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("favorites-dialog.png"), animations: "disabled" })

  // The answer has no anchor of its own, so its favorite jumps to the prompt that started the turn.
  await dialog.getByRole("option").filter({ hasText: "The answer worth keeping" }).click()
  await expect(dialog).toBeHidden()
  await expect(userRow).toBeInViewport()

  await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(userRow).not.toBeInViewport()

  const promptDialog = await openFavorites()
  await promptDialog.getByRole("option").filter({ hasText: "Build the timeline stability matrix" }).click()
  await expect(promptDialog).toBeHidden()
  await expect(userRow).toBeInViewport()
})
