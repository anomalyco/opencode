import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"
import { wdToggleReviewPanel } from "../../support/wd-actions"

async function expanded(el: { getAttribute(name: string): Promise<string | null> }) {
  const v = await el.getAttribute("aria-expanded")
  if (v !== "true" && v !== "false") throw new Error(`Expected aria-expanded true|false, got: ${v}`)
  return v === "true"
}

describe("panels (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("review panel can be toggled via keybind", async () => {
    await app.gotoSession()

    const reviewPanel = await waitVisible(app.driver, By.css("#review-panel"))

    const treeToggle = await waitVisible(
      app.driver,
      By.xpath(`(//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "toggle file tree")])[1]`),
    )
    if (await expanded(treeToggle)) await treeToggle.click()
    expect(await treeToggle.getAttribute("aria-expanded")).toBe("false")

    const reviewToggle = await waitVisible(
      app.driver,
      By.xpath(`(//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "toggle review")])[1]`),
    )
    if (await expanded(reviewToggle)) await reviewToggle.click()
    expect(await reviewToggle.getAttribute("aria-expanded")).toBe("false")
    expect(await reviewPanel.getAttribute("aria-hidden")).toBe("true")

    await wdToggleReviewPanel(app.driver)
    expect(await reviewToggle.getAttribute("aria-expanded")).toBe("true")
    expect(await reviewPanel.getAttribute("aria-hidden")).toBe("false")

    await wdToggleReviewPanel(app.driver)
    expect(await reviewToggle.getAttribute("aria-expanded")).toBe("false")
    expect(await reviewPanel.getAttribute("aria-hidden")).toBe("true")
  })
})
