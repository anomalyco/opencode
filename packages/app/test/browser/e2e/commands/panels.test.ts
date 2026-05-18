import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"

import { By } from "../../support/wd-wait"
import { fileTreeToggleSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppBrowser } from "../../support/use-app-browser"
import { wdToggleReviewPanel } from "../../support/wd-actions"

async function expanded(el: { getAttribute(name: string): Promise<string | null> }) {
  const v = await el.getAttribute("aria-expanded")
  if (v !== "true" && v !== "false") throw new Error(`Expected aria-expanded true|false, got: ${v}`)
  return v === "true"
}

describe("panels (webdriver migration)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("review panel can be toggled via keybind", async () => {
    await app.gotoSession()

    const reviewPanel = await waitVisible(app.page, By.css("#review-panel"))

    const treeToggle = await waitVisible(app.page, By.css(fileTreeToggleSelector))
    if (await expanded(treeToggle)) await treeToggle.click()
    expect(await treeToggle.getAttribute("aria-expanded")).toBe("false")

    const reviewToggle = app.page.getByRole("button", { name: /toggle review/i })
    await reviewToggle.waitFor({ state: "visible" })
    if (await expanded(reviewToggle)) await reviewToggle.click()
    expect(await reviewToggle.getAttribute("aria-expanded")).toBe("false")
    expect(await reviewPanel.getAttribute("aria-hidden")).toBe("true")

    await wdToggleReviewPanel(app.page)
    expect(await reviewToggle.getAttribute("aria-expanded")).toBe("true")
    expect(await reviewPanel.getAttribute("aria-hidden")).toBe("false")

    await wdToggleReviewPanel(app.page)
    expect(await reviewToggle.getAttribute("aria-expanded")).toBe("false")
    expect(await reviewPanel.getAttribute("aria-hidden")).toBe("true")
  })
})
