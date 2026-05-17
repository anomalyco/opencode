import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import { sessionIDFromUrl } from "../../../e2e/actions"
import { promptSelector } from "../../../e2e/selectors"
import { waitVisible } from "../support/wd-wait"
import { openProjectSession, useAppWebDriver } from "../support/use-app-webdriver"

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["ok"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

async function expandFileTree(driver: WebDriverLike) {
  const toggle = await waitVisible(driver, By.xpath(`//button[contains(., "Toggle file tree")]`))
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  const panel = await waitVisible(driver, By.css("#file-tree-panel"))
  const tabs = await panel.findElement(
    By.css('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]'),
  )
  await tabs.findElement(By.xpath(`.//button[@role="tab" and contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "all files")]`)).click()
  return panel
}

type WebDriverLike = import("selenium-webdriver").WebDriver

async function dropXlsx(driver: WebDriverLike, name: string, b64: string) {
  await driver.executeScript(
    `
    const payload = arguments[0];
    const panel = document.querySelector("#file-tree-panel");
    const raw = atob(payload.data);
    const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    const file = new File([u], payload.filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const data = new DataTransfer();
    data.items.add(file);
    const target = panel || document.body;
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: data }));
  `,
    { data: b64, filename: name },
  )
}

describe("univer upload (webdriver)", () => {
  const app = useAppWebDriver()

  test(
    "drop xlsx on file tree completes univer-compat exchange import",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-upload.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.driver)
      await dropXlsx(app.driver, name, b64)

      const row = await waitVisible(app.driver, By.xpath(`//*[@id="file-tree-panel"]//button[normalize-space(.)="${name}"]`), 120_000)
      await row.click()

      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="${name}"]`), 120_000)
      await app.driver.wait(
        async () => {
          const els = await app.driver.findElements(By.xpath(`//*[contains(., "Loading spreadsheet…")]`))
          if (els.length === 0) return true
          for (const el of els) {
            if (await el.isDisplayed()) return false
          }
          return true
        },
        120_000,
      )
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="Sheet1"]`), 120_000)
    },
    180_000,
  )

  test(
    "after full reload spreadsheet reloads from compat (resolved unit id)",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-refresh.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.driver)
      await dropXlsx(app.driver, name, b64)

      const row = await waitVisible(app.driver, By.xpath(`//*[@id="file-tree-panel"]//button[normalize-space(.)="${name}"]`), 120_000)
      await row.click()

      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="${name}"]`), 120_000)
      await app.driver.wait(
        async () => {
          const els = await app.driver.findElements(By.xpath(`//*[contains(., "Loading spreadsheet…")]`))
          if (els.length === 0) return true
          for (const el of els) {
            if (await el.isDisplayed()) return false
          }
          return true
        },
        120_000,
      )
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="Sheet1"]`), 120_000)

      await app.driver.navigate().refresh()
      await waitVisible(app.driver, By.css(promptSelector))
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="${name}"]`), 120_000)
      await app.driver.wait(
        async () => {
          const els = await app.driver.findElements(By.xpath(`//*[contains(., "Loading spreadsheet…")]`))
          if (els.length === 0) return true
          for (const el of els) {
            if (await el.isDisplayed()) return false
          }
          return true
        },
        120_000,
      )
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="Sheet1"]`), 120_000)
    },
    180_000,
  )

  test(
    "persisted sheet lists after new browser context (no localStorage)",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-fresh-context.xlsx"
      const b64 = Buffer.from(minimalXlsx()).toString("base64")

      await expandFileTree(app.driver)
      await dropXlsx(app.driver, name, b64)

      const row = await waitVisible(app.driver, By.xpath(`//*[@id="file-tree-panel"]//button[normalize-space(.)="${name}"]`), 120_000)
      await row.click()
      await app.driver.wait(
        async () => {
          const els = await app.driver.findElements(By.xpath(`//*[contains(., "Loading spreadsheet…")]`))
          if (els.length === 0) return true
          for (const el of els) {
            if (await el.isDisplayed()) return false
          }
          return true
        },
        120_000,
      )
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="Sheet1"]`), 120_000)

      const sessionUrl = await app.driver.getCurrentUrl()
      const sid = sessionIDFromUrl(sessionUrl)
      if (!sid) throw new Error("session id missing from url")

      await app.driver.manage().deleteAllCookies()
      await app.driver.executeScript(`localStorage.clear()`)
      await openProjectSession(app.driver, app.origin, app.project.id, sid)

      const toggle2 = await waitVisible(app.driver, By.xpath(`//button[contains(., "Toggle file tree")]`))
      if ((await toggle2.getAttribute("aria-expanded")) !== "true") await toggle2.click()
      const panel2 = await waitVisible(app.driver, By.css("#file-tree-panel"))
      const tabs2 = await panel2.findElement(
        By.css('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]'),
      )
      await tabs2.findElement(By.xpath(`.//button[@role="tab" and contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "all files")]`)).click()

      const imported = await waitVisible(
        app.driver,
        By.xpath(`//*[@id="file-tree-panel"]//button[normalize-space(.)="Imported Workbook.xlsx"]`),
        120_000,
      )
      await imported.click()
      await app.driver.wait(
        async () => {
          const els = await app.driver.findElements(By.xpath(`//*[contains(., "Loading spreadsheet…")]`))
          if (els.length === 0) return true
          for (const el of els) {
            if (await el.isDisplayed()) return false
          }
          return true
        },
        120_000,
      )
      await waitVisible(app.driver, By.xpath(`//button[@role="tab" and normalize-space(.)="Sheet1"]`), 120_000)
    },
    180_000,
  )
})
