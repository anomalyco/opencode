import { expect, test } from "@playwright/test"
import type {} from "./viewer"

test("reuses only matching patch, theme, and worker options", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => !!window.highlighting)
  const cold = await page.evaluate(() => window.highlighting.mount(1))
  expect(cold.workerRequests).toBe(1)
  expect(cold.cacheSize).toBe(1)
  const first = await page.locator('[data-line="11"][data-line-type="change-addition"]').innerHTML()
  await page.evaluate(() => window.highlighting.unmount())

  const cached = await page.evaluate(() => window.highlighting.mount(1))
  expect(cached.workerRequests).toBe(0)
  expect(await page.locator('[data-line="11"][data-line-type="change-addition"]').innerHTML()).toBe(first)
  await page.evaluate(() => window.highlighting.unmount())

  const changed = await page.evaluate(() => window.highlighting.mount(2))
  expect(changed.workerRequests).toBe(1)
  await expect(page.locator('[data-line="11"][data-line-type="change-addition"]')).toContainText("status: 202")
  await page.evaluate(() => window.highlighting.unmount())

  await page.evaluate(() => window.highlighting.configure({ theme: "github-dark" }))
  const themed = await page.evaluate(() => window.highlighting.mount(2))
  expect(themed.workerRequests).toBe(1)
  expect(themed.options.theme).toBe("github-dark")
  expect(themed.cacheSize).toBe(1)
  await page.evaluate(() => window.highlighting.unmount())

  await page.evaluate(() => window.highlighting.configure({ tokenizeMaxLineLength: 1 }))
  const plain = await page.evaluate(() => window.highlighting.mount(2))
  expect(plain.workerRequests).toBe(1)
  expect(plain.options.tokenizeMaxLineLength).toBe(1)
  expect(await page.evaluate(() => window.highlighting.contents()!.after === window.highlighting.input.after[1])).toBe(true)
})
