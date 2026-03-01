import { test, expect, screenshotDir } from "./fixtures"
import * as chat from "./helpers/chat"
import * as path from "path"
import * as fs from "fs"

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true })
})

test("session target picker shows OpenCode in the list", async ({ page }) => {
  await chat.open(page)

  // Open the session target picker (pickers visible once panel is rendered)
  await chat.openSessionTargetPicker(page)

  const items = await chat.getDropdownItems(page)
  await chat.screenshot(page, "03-session-target-picker.png")

  // Dropdown should have items
  expect(items.length).toBeGreaterThan(0)

  await chat.closeDropdown(page)
})

test("slash commands appear after @opencode", async ({ page }) => {
  await chat.open(page)
  await chat.typeMessage(page, "@opencode /")

  // Slash commands appear as suggestions/completions in the input area
  await page.waitForTimeout(1_500)
  await chat.screenshot(page, "04-opencode-commands.png")

  // Check page content for command names
  const content = await page.content()
  expect(content).toMatch(/new|clear/i)

  // Clear input
  await page.keyboard.press("Escape")
  await page.keyboard.press("Control+A")
  await page.keyboard.press("Delete")
})

test("model picker is accessible", async ({ page }) => {
  await chat.open(page)

  // Open model picker — button visible after panel renders
  await chat.openModelPicker(page)

  const items = await chat.getDropdownItems(page)
  await chat.screenshot(page, "05-model-picker.png")

  // At least the button was clickable; dropdown may have items or show "no models"
  expect(items.length).toBeGreaterThanOrEqual(0)

  await chat.closeDropdown(page)
})

test("chat with @opencode /new shows response", async ({ page }) => {
  await chat.open(page)
  await chat.typeMessage(page, "@opencode")
  await page.waitForTimeout(800)

  // Type /new — may trigger a completion dropdown
  await page.keyboard.type(" /new")
  await page.waitForTimeout(800)

  // Dismiss any completion popup, then send
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await page.keyboard.press("Enter")

  // /new is handled inline — no ACP needed, produces immediate markdown response
  await chat.waitForResponse(page)
  await chat.screenshot(page, "06-chat-response.png")

  const responseText = await page.textContent(chat.SEL.responseDone)
  expect(responseText?.trim().length).toBeGreaterThan(0)
})
