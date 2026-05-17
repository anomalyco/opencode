import { test, expect } from "../fixtures"

test("home load emits no console errors", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => {
    errors.push(err.message)
  })

  await page.goto("/")
  await expect(page.getByRole("button", { name: "Open project" }).first()).toBeVisible()
  await expect.poll(() => errors.slice(), { timeout: 8_000 }).toEqual([])
})
