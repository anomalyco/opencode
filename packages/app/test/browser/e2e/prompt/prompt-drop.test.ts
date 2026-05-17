import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { promptSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+4uQAAAAASUVORK5CYII="

describe("prompt drop (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("dropping an image file adds an attachment", async () => {
    await app.gotoSession()
    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()

    await app.driver.executeScript(
      `
      const b64 = arguments[0];
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "drop.png", { type: "image/png" });
      dt.items.add(file);
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
    `,
      png,
    )

    const img = await waitVisible(app.driver, By.xpath(`//img[@alt="drop.png"]`))
    expect(await img.isDisplayed()).toBe(true)

    const remove = await waitVisible(app.driver, By.xpath(`//button[contains(., "Remove attachment")]`))
    await app.driver.actions().move({ origin: img }).perform()
    await remove.click()

    await app.driver.wait(async () => (await app.driver.findElements(By.xpath(`//img[@alt="drop.png"]`))).length === 0, 5000)
  })

  test("dropping text/plain file: uri inserts a file pill", async () => {
    await app.gotoSession()
    const prompt = await waitVisible(app.driver, By.css(promptSelector))
    await prompt.click()

    const path = process.platform === "win32" ? "C:\\\\opencode-e2e-drop.txt" : "/tmp/opencode-e2e-drop.txt"
    await app.driver.executeScript(
      `
      const text = arguments[0];
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
    `,
      `file:${path}`,
    )

    const pill = await waitVisible(app.driver, By.css(`${promptSelector} [data-type="file"]`))
    expect(await pill.isDisplayed()).toBe(true)
    expect(await pill.getAttribute("data-path")).toBe(path)
  })
})
