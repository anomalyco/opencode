import { By, until, type WebDriver, type WebElement } from "selenium-webdriver"

export async function waitLocated(driver: WebDriver, by: By, ms = 30_000): Promise<WebElement> {
  return driver.wait(until.elementLocated(by), ms)
}

export async function waitVisible(driver: WebDriver, by: By, ms = 30_000): Promise<WebElement> {
  const el = await waitLocated(driver, by, ms)
  await driver.wait(until.elementIsVisible(el), ms)
  return el
}

export async function waitUrlMatches(driver: WebDriver, re: RegExp, ms = 30_000) {
  await driver.wait(async () => re.test(await driver.getCurrentUrl()), ms)
}

/** Wait until no elements match `by` (e.g. popover detached). */
export async function waitAbsent(driver: WebDriver, by: By, ms = 15_000) {
  await driver.wait(async () => (await driver.findElements(by)).length === 0, ms)
}

export { By }
