import { describe, expect, test } from "vitest"
import { projectPath } from "../../../../e2e/utils"
import { promptSelector } from "../../../../e2e/selectors"
import { By, waitUrlMatches, waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("navigation (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("project route redirects to /session", async () => {
    const slug = app.project.id
    await app.driver.get(`${app.origin}${projectPath(slug)}`)
    await waitUrlMatches(app.driver, new RegExp(`/${slug}/session`))
    await waitVisible(app.driver, By.css(promptSelector))
  })
})
