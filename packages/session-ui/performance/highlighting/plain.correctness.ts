import { expect, test } from "@playwright/test"
import type {} from "./viewer"

test("renders large diffs as plain text without changing ordinary highlighting", async ({ page }) => {
  await page.goto("/?large")
  await page.waitForFunction(() => !!window.highlighting)
  const large = await page.evaluate(() => window.highlighting.mount(1))
  expect(large.options).toMatchObject({ lineDiffType: "none", maxLineDiffLength: 0, tokenizeMaxLineLength: 1 })
  expect(large.syntaxSpans).toBe(0)
  await expect(page.locator('[data-line="11"][data-line-type="change-addition"]')).toContainText("status: 201")
  expect(await page.evaluate(() => window.highlighting.contents()!.after === window.highlighting.input.after[0])).toBe(true)

  await page.goto("/")
  await page.waitForFunction(() => !!window.highlighting)
  const ordinary = await page.evaluate(() => window.highlighting.mount(1))
  expect(ordinary.options).toMatchObject({ lineDiffType: "word-alt", maxLineDiffLength: 1000, tokenizeMaxLineLength: 1000 })
  expect(ordinary.syntaxSpans).toBeGreaterThan(0)
  await expect(page.locator('[data-line="11"][data-line-type="change-addition"]')).toContainText("status: 201")
})
