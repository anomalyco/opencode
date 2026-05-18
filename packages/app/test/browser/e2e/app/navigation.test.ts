import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"

import { projectPath } from "../../../../e2e/utils"
import { promptSelector } from "../../../../e2e/selectors"
import { By, waitUrlMatches, waitVisible } from "../../support/wd-wait"
import { useAppBrowser } from "../../support/use-app-browser"

describe("navigation (webdriver migration)", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("project route redirects to /session", async () => {
    const slug = app.project.id
    await app.page.goto(`${app.origin}${projectPath(slug)}`)
    await waitUrlMatches(app.page, new RegExp(`/${slug}/session`))
    await waitVisible(app.page, By.css(promptSelector))
  })
})
