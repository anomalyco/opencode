import { seedSessionTask, withSession } from "../actions"
import { test, expect } from "../fixtures"
import { inputMatch } from "../prompt/mock"

test("task tool child-session link does not trigger stale show errors", async ({ page, llm, project }) => {
  test.setTimeout(120_000)

  const errs: string[] = []
  const onError = (err: Error) => {
    errs.push(err.message)
  }
  page.on("pageerror", onError)

  try {
    await project.open()
    await withSession(project.sdk, `e2e child nav ${Date.now()}`, async (session) => {
      const taskInput = {
        description: "Open child session",
        prompt: "Search the repository for AssistantParts and then reply with exactly CHILD_OK.",
        subagent_type: "general",
      }
      await llm.toolMatch(inputMatch(taskInput), "task", taskInput)
      const child = await seedSessionTask(project.sdk, {
        sessionID: session.id,
        description: taskInput.description,
        prompt: taskInput.prompt,
      })
      project.trackSession(child.sessionID)

      await project.gotoSession(session.id)

      const header = page.locator("[data-session-title]")
      await expect(header.getByRole("button", { name: "More options" })).toBeVisible({ timeout: 30_000 })

      const card = page
        .locator('[data-component="task-tool-card"]')
        .filter({ hasText: /open child session/i })
        .first()
      await expect(card).toBeVisible({ timeout: 30_000 })
      await card.click()

      await expect(page).toHaveURL(new RegExp(`/session/${child.sessionID}(?:[/?#]|$)`), { timeout: 30_000 })
      await expect(header.locator('[data-slot="session-title-parent"]')).toHaveText(session.title)
      await expect(header.locator('[data-slot="session-title-child"]')).toHaveText(taskInput.description)
      await expect(header.locator('[data-slot="session-title-separator"]')).toHaveText("/")
      await expect
        .poll(
          () =>
            header.locator('[data-slot="session-title-separator"]').evaluate((el) => ({
              left: getComputedStyle(el).paddingLeft,
              right: getComputedStyle(el).paddingRight,
            })),
          { timeout: 30_000 },
        )
        .toEqual({ left: "8px", right: "8px" })
      await expect(header.getByRole("button", { name: "More options" })).toHaveCount(0)
      await expect(page.getByText("Subagent sessions cannot be prompted.")).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole("button", { name: "Back to main session." })).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => errs, { timeout: 5_000 }).toEqual([])
    })
  } finally {
    page.off("pageerror", onError)
  }
})
