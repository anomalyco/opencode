import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import { waitUrlMatches, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("project create (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("new project appears in sidebar and is selected", async () => {
    await app.driver.get(`${app.origin}/`)

    const name = `E2E Project ${Date.now()}`
    const rail = await waitVisible(app.driver, By.css('[data-component="sidebar-rail"]'))
    await rail.findElement(By.xpath(`.//button[contains(., "New project")]`)).click()

    const dialog = await waitVisible(app.driver, By.xpath(`//*[@role="dialog"][contains(., "Create a new project")]`))
    const nameInput = await dialog.findElement(By.css("input"))
    await nameInput.clear()
    await nameInput.sendKeys(name)
    await dialog.findElement(By.xpath(`.//button[contains(., "Create project")]`)).click()

    await app.driver.wait(async () => /\/[^/]+\/session(?:[/?#]|$)/.test(await app.driver.getCurrentUrl()), 30_000)
    const path = new URL(await app.driver.getCurrentUrl()).pathname
    const projectID = path.split("/").filter(Boolean)[0]
    if (!projectID) throw new Error("project id from url missing")

    await waitUrlMatches(app.driver, new RegExp(`/${projectID}/session(?:[/?#]|$)`))

    const tile = await waitVisible(app.driver, By.css(`[data-action="project-switch"][data-project="${projectID}"]`))
    expect(await tile.getAttribute("aria-label")).toBe(name)
    expect(await tile.getAttribute("aria-current")).toBe("page")
  })
})
