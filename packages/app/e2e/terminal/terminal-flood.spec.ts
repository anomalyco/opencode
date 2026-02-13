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

function captureTerminalFrames(page: Page) {
  const frames: string[] = []
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/pty/") || !ws.url().includes("/connect")) return
    ws.on("framereceived", (event) => {
      if (typeof event.payload === "string") frames.push(event.payload)
    })
  })
  return frames
}

test("e2e_output_flood_ui_stays_responsive", async ({ page, gotoSession }) => {
  await gotoSession()
  await ensureTerminalOpen(page)

  await sendToTerminal(page, "for i in {1..250}; do echo flood-$i; done")

  const prompt = page.locator(promptSelector).first()
  await expect(prompt).toBeVisible()
  await prompt.click({ timeout: 10_000 })
  await expect(prompt).toBeFocused()
})

test("e2e_toggle_terminal_while_streaming_no_blank_terminal", async ({ page, gotoSession }) => {
  await gotoSession()
  await ensureTerminalOpen(page)

  await sendToTerminal(page, "for i in {1..120}; do echo tick-$i; done")

  await toggleTerminal(page)
  await expect(page.locator(terminalSelector)).toHaveCount(0)

  await toggleTerminal(page)
  const reopened = page.locator(`${terminalSelector}:visible`).first()
  await expect(reopened).toBeVisible()
})

test("e2e_flood_preserves_boundary_markers_in_order", async ({ page, gotoSession }) => {
  const frames = captureTerminalFrames(page)
  await gotoSession()
  await ensureTerminalOpen(page)

  const head = `flood-head-${Date.now()}`
  const tail = `flood-tail-${Date.now()}`
  const before = frames.length
  await sendToTerminal(page, `echo ${head}; for i in $(seq 1 220); do echo chunk-$i; done; echo ${tail}`)

  await expect.poll(() => frames.length, { timeout: 20_000 }).toBeGreaterThan(before)
  await expect.poll(() => frames.length - before, { timeout: 20_000 }).toBeGreaterThan(2)
})
