import { test, expect } from "../fixtures"
import { runPromptSlash, waitTerminalFocusIdle } from "../actions"
import { promptSelector, terminalSelector } from "../selectors"

test("/terminal toggles the terminal panel", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  const terminal = page.locator(terminalSelector)

  await expect(terminal).not.toBeVisible()

  await runPromptSlash(page, { prompt, text: "/terminal", id: "terminal.toggle" })
  await waitTerminalFocusIdle(page, { term: terminal })

  await runPromptSlash(page, { prompt, text: "/terminal", id: "terminal.toggle" })
  await expect(terminal).not.toBeVisible()
})
