import { seedSessionTask, withSession } from "../actions"
import { test, expect } from "../fixtures"
import { inputMatch } from "../prompt/mock"
import { promptSelector } from "../selectors"

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

      const link = page
        .locator("a.subagent-link")
        .filter({ hasText: /open child session/i })
        .first()
      await expect(link).toBeVisible({ timeout: 30_000 })
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/session/${child.sessionID}(?:[/?#]|$)`), { timeout: 30_000 })
      await expect(page.locator(promptSelector)).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => errs, { timeout: 5_000 }).toEqual([])
    })
  } finally {
    page.off("pageerror", onError)
  }
})
