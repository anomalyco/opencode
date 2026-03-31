import type { Page } from "@playwright/test"
import { disconnectTerminal, runTerminal, terminalConnects, waitTerminalReady } from "../actions"
import { test, expect } from "../fixtures"
import { terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"

async function open(page: Page) {
  const term = page.locator(terminalSelector).first()
  const visible = await term.isVisible().catch(() => false)
  if (!visible) await page.keyboard.press(terminalToggleKey)
  await waitTerminalReady(page, { term })
  return term
}

test("terminal reconnects without replacing the pty", async ({ page, withProject }) => {
  await withProject(async ({ gotoSession }) => {
    const name = `OPENCODE_E2E_RECONNECT_${Date.now()}`
    const token = `E2E_RECONNECT_${Date.now()}`

    await gotoSession()

    const term = await open(page)
    const id = await term.getAttribute("data-pty-id")
    if (!id) throw new Error("Active terminal missing data-pty-id")

    const prev = await terminalConnects(page, { term })

    await runTerminal(page, {
      term,
      cmd: `export ${name}=${token}; echo ${token}`,
      token,
    })

    await disconnectTerminal(page, { term })

    await expect.poll(() => terminalConnects(page, { term }), { timeout: 15_000 }).toBeGreaterThan(prev)
    await expect.poll(() => term.getAttribute("data-pty-id"), { timeout: 5_000 }).toBe(id)

    await runTerminal(page, {
      term,
      cmd: `echo $${name}`,
      token,
      timeout: 15_000,
    })
  })
})
