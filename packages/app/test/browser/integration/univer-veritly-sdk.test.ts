import { Buffer } from "node:buffer"
import * as XLSX from "xlsx"
import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { fileTreeAllTabTriggerSelector, fileTreeToggleSelector } from "../../../e2e/selectors"
import { waitVisible } from "../support/wd-wait"
import { useAppWebDriver } from "../support/use-app-webdriver"

function minimalXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["seed"]])
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
}

function cellPrimitive(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "object" && v !== null && "v" in v) return String((v as { v: unknown }).v)
  return String(v)
}

async function expandFileTree(driver: import("selenium-webdriver").WebDriver) {
  const toggle = await waitVisible(driver, By.css(fileTreeToggleSelector))
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "true", 10_000)
  await driver.wait(
    async () =>
      Number(
        await driver.executeScript(
          `return document.getElementById("file-tree-panel")?.getBoundingClientRect().width ?? 0`,
        ),
      ) > 100,
    15_000,
  )
  await waitVisible(driver, By.css("#file-tree-panel"))
  const allTab = await waitVisible(driver, By.css(fileTreeAllTabTriggerSelector))
  await allTab.click()
}

async function dropXlsx(driver: import("selenium-webdriver").WebDriver, name: string, b64: string) {
  await driver.executeScript(
    `
    const payload = arguments[0];
    const panel = document.querySelector("#file-tree-panel");
    const tree = panel?.querySelector('[data-component="filetree"]');
    if (!(tree instanceof HTMLElement)) throw new Error("file tree droppable root missing");
    const raw = atob(payload.data);
    const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    const file = new File([u], payload.filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const data = new DataTransfer();
    data.items.add(file);
    const ev = { bubbles: true, cancelable: true, dataTransfer: data };
    tree.dispatchEvent(new DragEvent("dragenter", ev));
    tree.dispatchEvent(new DragEvent("dragover", ev));
    tree.dispatchEvent(new DragEvent("drop", ev));
  `,
    { data: b64, filename: name },
  )
}

describe("univer veritly sdk (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test(
    "Veritly SDK hook edits sheet after compat import",
    async () => {
      await app.gotoSession()
      const name = "e2e-univer-sdk.xlsx"
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

      const matrix = (await app.driver.executeScript(`
        const w = window;
        const sdk = w.__veritlyUniverSdk?.();
        if (!sdk) throw new Error("missing window.__veritlyUniverSdk — run docker-backed E2E via e2e-local with univer layer");
        sdk.setRangeValues({
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          values: [["sdk-e2e"]],
        });
        return sdk.getSheetRange({
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
        });
      `)) as unknown[][]

      expect(cellPrimitive(matrix[0]?.[0])).toBe("sdk-e2e")
    },
    180_000,
  )
})
