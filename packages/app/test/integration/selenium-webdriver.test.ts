import { describe, expect, test } from "vitest"
import { useSeleniumWebDriver } from "../support/with-selenium-webdriver"

describe("selenium standalone (testcontainers module)", () => {
  const web = useSeleniumWebDriver()

  test("navigate remote page", async () => {
    await web.driver.get("https://example.com/")
    const title = await web.driver.getTitle()
    expect(title).toContain("Example")
  })
})
