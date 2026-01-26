import { test, expect } from "./fixtures"

test("external links are intercepted and don't navigate the app", async ({ page, context, slug, gotoSession }) => {
  await gotoSession()

  await page.evaluate(() => {
    const link = document.createElement("a")
    link.href = "https://opencode.ai"
    link.id = "test-external-link"
    link.textContent = "External"
    link.style.display = "block"
    document.body.appendChild(link)
  })

  const currentUrl = page.url()
  const popupPromise = context.waitForEvent("page")
  await page.click("#test-external-link")

  const popup = await Promise.race([
    popupPromise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Popup did not open")), 2000)),
  ]).catch(() => null)

  await expect(page).toHaveURL(new RegExp(`/${slug}/session`))
  expect(page.url()).toBe(currentUrl)

  if (popup) {
    expect(popup.url()).toContain("opencode.ai")
  }
})

test("internal links navigate within the app", async ({ page, slug, gotoSession }) => {
  await gotoSession()

  await page.evaluate((slug) => {
    const link = document.createElement("a")
    link.href = `/${slug}`
    link.id = "test-internal-link"
    link.textContent = "Internal"
    link.style.display = "block"
    document.body.appendChild(link)
  }, slug)

  await page.click("#test-internal-link")

  await expect(page).toHaveURL(new RegExp(`/${slug}($|/)`))
})

test("localhost links are treated as internal", async ({ page, gotoSession }) => {
  await gotoSession()
  const initialUrl = page.url()

  await page.evaluate(() => {
    const link = document.createElement("a")
    link.href = `http://localhost:${window.location.port}/`
    link.id = "test-localhost-link"
    link.textContent = "Localhost"
    link.style.display = "block"
    document.body.appendChild(link)
  })

  await page.click("#test-localhost-link")
  await page.waitForTimeout(100)

  const newUrl = page.url()
  expect(new URL(initialUrl).hostname).toBe(new URL(newUrl).hostname)
})
