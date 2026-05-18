import type { Locator, Page } from "playwright"
import { expect } from "vitest"

export type WdBy = { t: "css" | "xpath"; v: string }

export const By = {
  css: (v: string): WdBy => ({ t: "css", v }),
  xpath: (v: string): WdBy => ({ t: "xpath", v }),
  id: (id: string): WdBy => ({ t: "css", v: `#${id}` }),
}

export function loc(page: Page, by: WdBy): Locator {
  return by.t === "css" ? page.locator(by.v) : page.locator(`xpath=${by.v}`)
}

export async function waitLocated(page: Page, by: WdBy, ms = 30_000): Promise<Locator> {
  const l = loc(page, by)
  await l.waitFor({ state: "attached", timeout: ms })
  return l
}

export async function waitVisible(page: Page, by: WdBy, ms = 30_000): Promise<Locator> {
  const l = loc(page, by)
  await l.waitFor({ state: "visible", timeout: ms })
  return l
}

export async function waitUrlMatches(page: Page, re: RegExp, ms = 30_000) {
  await page.waitForURL(re, { timeout: ms })
}

export async function waitAbsent(page: Page, by: WdBy, ms = 15_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await loc(page, by).count()) === 0) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("waitAbsent: elements still present")
}

/** Replaces Selenium `driver.wait(async () => cond, ms)`. */
export async function pollOk(fn: () => Promise<boolean>, ms: number, interval = 50) {
  await expect.poll(fn, { timeout: ms, interval }).toBe(true)
}
