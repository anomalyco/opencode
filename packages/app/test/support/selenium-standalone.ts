import { SeleniumContainer, type StartedSeleniumContainer } from "@testcontainers/selenium"
import { Builder, Browser, logging } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"

export function defaultStandaloneImage(): string {
  const override = process.env.SELENIUM_STANDALONE_IMAGE?.trim()
  if (override) return override
  const arm = process.arch === "arm64"
  if (arm) return "seleniarm/standalone-chromium:latest"
  return "selenium/standalone-chrome:latest"
}

/** One Selenium standalone container + remote WebDriver (caller owns lifecycle). */
export async function startStandaloneSelenium(): Promise<{
  driver: WebDriver
  box: StartedSeleniumContainer
  stop: () => Promise<void>
}> {
  const box = await new SeleniumContainer(defaultStandaloneImage()).start()
  const prefs = new logging.Preferences()
  prefs.setLevel(logging.Type.BROWSER, logging.Level.ALL)
  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .usingServer(box.getServerUrl())
    .setLoggingPrefs(prefs)
    .build()
  return {
    driver,
    box,
    stop: async () => {
      await driver.quit()
      await box.stop()
    },
  }
}
