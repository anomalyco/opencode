import { afterAll, beforeAll } from "vitest"
import type { WebDriver } from "selenium-webdriver"
import { startStandaloneSelenium } from "./selenium-standalone"

/**
 * File-scoped Selenium Grid **standalone** container + WebDriver session (Vitest `beforeAll` / `afterAll`).
 * Uses `@testcontainers/selenium` (`SeleniumContainer`) and `selenium-webdriver` `Builder` against `getServerUrl()`.
 *
 * Pin images in CI: `SELENIUM_STANDALONE_IMAGE=seleniarm/standalone-chromium:<digest-or-tag>`.
 */
export function useSeleniumWebDriver() {
  let driver: WebDriver | undefined
  let stop: (() => Promise<void>) | undefined

  beforeAll(async () => {
    const s = await startStandaloneSelenium()
    driver = s.driver
    stop = s.stop
  }, 300_000)

  afterAll(async () => {
    if (stop) await stop()
  }, 120_000)

  return {
    get driver(): WebDriver {
      if (!driver) throw new Error("WebDriver not ready — beforeAll did not run or failed")
      return driver
    },
  }
}
