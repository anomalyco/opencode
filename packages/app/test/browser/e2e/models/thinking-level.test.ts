import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { modelVariantCycleSelector } from "../../../../e2e/selectors"

describe("thinking level / model variant", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("smoke model variant cycle updates label", async () => {
    await app.gotoSession()

    await app.page.addStyleTag({
      content: `${modelVariantCycleSelector} { display: inline-block !important; }`,
    })

    const button = app.page.locator(modelVariantCycleSelector)
    if ((await button.count()) === 0) return

    await button.waitFor({ state: "visible" })

    const before = (await button.innerText()).trim()
    await button.click()
    await expect.poll(async () => (await button.innerText()).trim()).not.toBe(before)

    const mid = (await button.innerText()).trim()
    await button.click()
    await expect.poll(async () => (await button.innerText()).trim()).not.toBe(mid)
  })
})
