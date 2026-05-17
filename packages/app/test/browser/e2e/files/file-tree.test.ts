import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By, until } from "selenium-webdriver"
import { fileTreeToggleSelector } from "../../../../e2e/selectors"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

describe("file tree (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("file tree can expand folders and open a file", async () => {
    await app.gotoSession()

    const toggle = await waitVisible(app.driver, By.css(fileTreeToggleSelector))
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
    await app.driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "true", 10_000)

    await waitVisible(app.driver, By.id("file-tree-panel"))
    await waitVisible(
      app.driver,
      By.css('#file-tree-panel [data-component="tabs"][data-variant="pill"][data-scope="filetree"]'),
    )

    const treeTabs = await app.driver.findElement(
      By.css('#file-tree-panel [data-component="tabs"][data-variant="pill"][data-scope="filetree"]'),
    )

    const allTab = await treeTabs.findElement(By.css('button[data-slot="tabs-trigger"][data-value="all"]'))
    await app.driver.wait(until.elementIsVisible(allTab), 30_000)
    await allTab.click()
    await app.driver.wait(async () => (await allTab.getAttribute("aria-selected")) === "true", 10_000)

    const tree = await app.driver.findElement(
      By.css(
        '#file-tree-panel [data-component="tabs"][data-variant="pill"][data-scope="filetree"] [data-slot="tabs-content"]:not([hidden])',
      ),
    )
    await app.driver.wait(until.elementIsVisible(tree), 30_000)

    const expand = async (n: string) => {
      const folder = await tree.findElement(
        By.xpath(`.//button[@aria-expanded][.//span[normalize-space(.)='${n}']]`),
      )
      await app.driver.wait(until.elementIsVisible(folder), 30_000)
      if ((await folder.getAttribute("aria-expanded")) === "false") await folder.click()
      await app.driver.wait(async () => (await folder.getAttribute("aria-expanded")) === "true", 15_000)
    }

    await expand("packages")
    await expand("app")
    await expand("src")
    await expand("components")

    const fileBtn = await tree.findElement(
      By.xpath(`.//button[.//span[normalize-space(.)='file-tree.tsx']]`),
    )
    await app.driver.wait(until.elementIsVisible(fileBtn), 30_000)
    await fileBtn.click()

    const tabs = await app.driver.findElements(
      By.xpath(`//button[@role="tab" and normalize-space(.)="file-tree.tsx"]`),
    )
    if (tabs.length === 0) throw new Error("expected editor tab for file-tree.tsx")
    const tab = tabs[0]!
    await app.driver.wait(until.elementIsVisible(tab), 30_000)
    await tab.click()
    await app.driver.wait(async () => (await tab.getAttribute("aria-selected")) === "true", 10_000)

    await toggle.click()
    await app.driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "false", 10_000)

    await toggle.click()
    await app.driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "true", 10_000)
    await app.driver.wait(async () => (await allTab.getAttribute("aria-selected")) === "true", 10_000)

    const viewer = await waitVisible(app.driver, By.css('[data-component="file"][data-mode="text"]'))
    expect(await viewer.getText()).toContain("export default function FileTree")
  })
})
