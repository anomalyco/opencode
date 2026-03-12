import type { Page } from "@playwright/test"
import { runTerminal, waitTerminalReady } from "../actions"
import { test, expect } from "../fixtures"
import { terminalSelector } from "../selectors"
import { terminalToggleKey, workspacePersistKey } from "../utils"

type State = {
  active?: string
  all: Array<{
    id: string
    title: string
    titleNumber: number
    buffer?: string
  }>
}

async function open(page: Page) {
  const terminal = page.locator(terminalSelector)
  const visible = await terminal.isVisible().catch(() => false)
  if (!visible) await page.keyboard.press(terminalToggleKey)
  await waitTerminalReady(page, { term: terminal })
}

async function store(page: Page, key: string) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as State

    for (let i = 0; i < localStorage.length; i++) {
      const next = localStorage.key(i)
      if (!next?.endsWith(":workspace:terminal")) continue
      const value = localStorage.getItem(next)
      if (!value) continue
      return JSON.parse(value) as State
    }
  }, key)
}

test("inactive terminal tab buffers persist across tab switches", async ({ page, withProject }) => {
  await withProject(async ({ directory, gotoSession }) => {
    const key = workspacePersistKey(directory, "terminal")
    const one = `E2E_TERM_ONE_${Date.now()}`
    const two = `E2E_TERM_TWO_${Date.now()}`
    const tabs = page.locator('#terminal-panel [data-slot="tabs-trigger"]')
    const first = tabs.filter({ hasText: /Terminal 1/ }).first()
    const second = tabs.filter({ hasText: /Terminal 2/ }).first()

    await gotoSession()
    await open(page)

    await runTerminal(page, { cmd: `echo ${one}`, token: one })

    await page.getByRole("button", { name: /new terminal/i }).click()
    await expect(tabs).toHaveCount(2)

    await runTerminal(page, { cmd: `echo ${two}`, token: two })

    await first.click()
    await expect(first).toHaveAttribute("aria-selected", "true")

    await expect
      .poll(
        async () => {
          const state = await store(page, key)
          const first = state?.all.find((item) => item.titleNumber === 1)?.buffer ?? ""
          const second = state?.all.find((item) => item.titleNumber === 2)?.buffer ?? ""
          return {
            first: first.includes(one),
            second: second.includes(two),
          }
        },
        { timeout: 5_000 },
      )
      .toEqual({ first: false, second: true })

    await second.click()
    await expect(second).toHaveAttribute("aria-selected", "true")
    await expect
      .poll(
        async () => {
          const state = await store(page, key)
          const first = state?.all.find((item) => item.titleNumber === 1)?.buffer ?? ""
          const second = state?.all.find((item) => item.titleNumber === 2)?.buffer ?? ""
          return {
            first: first.includes(one),
            second: second.includes(two),
          }
        },
        { timeout: 5_000 },
      )
      .toEqual({ first: true, second: false })
  })
})

test("closing the active terminal tab falls back to the previous tab", async ({ page, withProject }) => {
  await withProject(async ({ directory, gotoSession }) => {
    const key = workspacePersistKey(directory, "terminal")
    const tabs = page.locator('#terminal-panel [data-slot="tabs-trigger"]')

    await gotoSession()
    await open(page)

    await page.getByRole("button", { name: /new terminal/i }).click()
    await expect(tabs).toHaveCount(2)

    const second = tabs.filter({ hasText: /Terminal 2/ }).first()
    await second.click()
    await expect(second).toHaveAttribute("aria-selected", "true")

    await second.hover()
    await page
      .getByRole("button", { name: /close terminal/i })
      .nth(1)
      .click({ force: true })

    const first = tabs.filter({ hasText: /Terminal 1/ }).first()
    await expect(tabs).toHaveCount(1)
    await expect(first).toHaveAttribute("aria-selected", "true")
    await expect
      .poll(
        async () => {
          const state = await store(page, key)
          return {
            count: state?.all.length ?? 0,
            first: state?.all.some((item) => item.titleNumber === 1) ?? false,
          }
        },
        { timeout: 15_000 },
      )
      .toEqual({ count: 1, first: true })
  })
})
