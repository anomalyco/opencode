import type { Page } from "@playwright/test"
import * as path from "path"
import { screenshotDir } from "../fixtures"

// Selectors based on VS Code 1.109.5 secondary sidebar chat panel DOM
export const SEL = {
  // Input area — Monaco editor in chat input part
  input: '.interactive-input-part .monaco-editor[role="code"]',
  inputFocused: '.interactive-input-part .monaco-editor.focused[role="code"]',
  // The textbox inside the Monaco editor (accessible target)
  inputBox: '.interactive-input-part [role="code"] .view-lines',
  // Response containers
  response: ".interactive-item-container.interactive-response",
  responseDone: ".interactive-item-container.interactive-response:not(.chat-response-loading)",
  // Picker buttons (VS Code 1.109.5 aria-labels — using partial match by title prefix)
  sessionTargetBtn: 'button[title^="Set Session Target"], button[aria-label^="Set Session Target"]',
  agentPickerBtn: 'button[title^="Set Agent"], button[aria-label^="Set Agent"]',
  modelPickerBtn: 'button[title^="Pick Model"], button[aria-label^="Pick Model"]',
  // Dropdown items (action widget or context view)
  dropdownLabel: ".action-widget .action-label, .context-view .action-label",
} as const

export async function open(page: Page) {
  // Open Chat via Ctrl+Shift+I (secondary sidebar)
  await page.keyboard.press("Control+Shift+I")
  // Wait for the chat input Monaco editor
  await page.waitForSelector(SEL.input, { timeout: 15_000 })
  // Extra stabilization time for the panel to fully render
  await page.waitForTimeout(1_500)
}

export async function focusInput(page: Page) {
  // Click the input area to give it focus
  await page.click(SEL.input)
  // Don't wait for .focused class — just give a short settle time
  await page.waitForTimeout(500)
}

export async function typeMessage(page: Page, text: string) {
  await focusInput(page)
  await page.keyboard.type(text)
}

export async function submit(page: Page) {
  await page.keyboard.press("Enter")
}

export async function openModelPicker(page: Page) {
  // Use accessible name matching for VS Code's picker buttons
  const btn = page.getByRole("button", { name: /Pick Model/i })
  await btn.waitFor({ state: "visible", timeout: 10_000 })
  await btn.click()
  await page.waitForTimeout(1_000)
}

export async function getDropdownItems(page: Page): Promise<string[]> {
  return page.$$eval(SEL.dropdownLabel, (els) => els.map((el) => el.textContent?.trim() ?? "").filter(Boolean))
}

export async function closeDropdown(page: Page) {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)
}

export async function openModePicker(page: Page) {
  const btn = page.locator(SEL.agentPickerBtn).first()
  await btn.waitFor({ state: "visible", timeout: 10_000 })
  await btn.click()
  await page.waitForTimeout(1_000)
}

export async function openSessionTargetPicker(page: Page) {
  // Use accessible name matching for VS Code's picker buttons
  const btn = page.getByRole("button", { name: /Set Session Target/i })
  await btn.waitFor({ state: "visible", timeout: 10_000 })
  await btn.click()
  await page.waitForTimeout(1_000)
}

export async function waitForResponse(page: Page) {
  await page.waitForSelector(SEL.responseDone, { timeout: 30_000 })
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(screenshotDir, name), type: "png" })
}
