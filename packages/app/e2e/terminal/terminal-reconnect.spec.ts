import { expect, test } from "../fixtures"
import { promptSelector, terminalSelector } from "../selectors"
import { terminalToggleKey } from "../utils"
import type { Page } from "@playwright/test"

async function toggleTerminal(page: Page) {
  const button = page.locator('button[aria-controls="terminal-panel"]').first()
  if (await button.isVisible()) {
    await button.click()
    return
  }
  await page.keyboard.press(terminalToggleKey)
}

async function ensureTerminalOpen(page: Page) {
  const terminal = page.locator(`${terminalSelector}:visible`).first()
  if (await terminal.isVisible().catch(() => false)) return terminal
  for (const _ of [0, 1, 2]) {
    await toggleTerminal(page)
    if (await terminal.isVisible().catch(() => false)) return terminal
    await page.keyboard.press(terminalToggleKey)
    if (await terminal.isVisible().catch(() => false)) return terminal
  }
  await expect(terminal).toBeVisible({ timeout: 20_000 })
  return terminal
}

async function sendToTerminal(page: Page, command: string) {
  const terminal = await ensureTerminalOpen(page)
  const input = terminal.locator("textarea").first()
  if (await input.count()) {
    await input.click({ force: true })
    await input.type(command)
    await input.press("Enter")
    return
  }
  await terminal.click({ force: true })
  await page.keyboard.type(command)
  await page.keyboard.press("Enter")
}

test("e2e_reconnect_preserves_recent_output", async ({ page, gotoSession }) => {
  const frames: string[] = []
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/pty/") || !ws.url().includes("/connect")) return
    ws.on("framereceived", (event) => {
      if (typeof event.payload === "string") frames.push(event.payload)
    })
  })

  await gotoSession()
  await ensureTerminalOpen(page)

  const replayToken = `reconnect-token-${Date.now()}`
  const beforeCommand = frames.length
  await sendToTerminal(page, `printf '${replayToken}\\n'`)
  await expect.poll(() => frames.length, { timeout: 20_000 }).toBeGreaterThan(beforeCommand)
  const beforeReload = frames.length

  await page.reload()
  await expect(page.locator(promptSelector).first()).toBeVisible()
  await ensureTerminalOpen(page)
  await expect.poll(() => frames.length, { timeout: 20_000 }).toBeGreaterThan(beforeReload)

  const postToken = `reconnect-post-${Date.now()}`
  await sendToTerminal(page, `printf '${postToken}\\n'`)
})

test("e2e_reconnect_during_high_output_keeps_stream_alive", async ({ page, gotoSession }) => {
  const frames: string[] = []
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/pty/") || !ws.url().includes("/connect")) return
    ws.on("framereceived", (event) => {
      if (typeof event.payload === "string") frames.push(event.payload)
    })
  })

  await gotoSession()
  await ensureTerminalOpen(page)

  const token = `hv-${Date.now()}`
  const beforeBurst = frames.length
  await sendToTerminal(page, `for i in $(seq 1 220); do echo ${token}-$i; sleep 0.01; done`)
  await expect.poll(() => frames.length, { timeout: 20_000 }).toBeGreaterThan(beforeBurst)

  const beforeReload = frames.length
  await page.reload()
  await expect(page.locator(promptSelector).first()).toBeVisible()
  await ensureTerminalOpen(page)
  await expect.poll(() => frames.length, { timeout: 30_000 }).toBeGreaterThan(beforeReload)
})

test("e2e_split_tabs_during_reconnect_no_hang", async ({ page, gotoSession }) => {
  await gotoSession()

  await ensureTerminalOpen(page)
  const terminals = page.locator(terminalSelector)

  await page.keyboard.press("Control+Alt+T")
  await expect(terminals).toHaveCount(2)

  await page.reload()
  await expect(page.locator(promptSelector).first()).toBeVisible()
  await ensureTerminalOpen(page)
  await expect(page.locator(`${terminalSelector}:visible`).first()).toBeVisible()
})
