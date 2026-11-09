#!/usr/bin/env bun
// Checks that switching the language client-side (the picker's dropdown on a desktop, its sheet on a
// phone, then back and forward) relabels everything: the sidebar nav, the footer, html lang and dir,
// and the title match what the server renders for that language. Also checks that a nav label
// renamed in Design mode shows in English only. Run it with the dev server running (default
// http://localhost:3011):
//   bun script/check-locale-switch.ts [base URL]
// Playwright installs into a temporary folder, so the app takes no dependency on it. Exits 1 when a
// value doesn't follow the language.
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

const base = process.argv[2] ?? "http://localhost:3011"
const steps = ["es", "fr", "ar"]

const tmp = await mkdtemp(join(tmpdir(), "locale-switch-"))
await Bun.$`bun add playwright@1.57.0 && bunx playwright install chromium`.cwd(tmp).quiet()
// The few Playwright calls used here (the package isn't a dependency, so no types come with it).
type Page = {
  goto(url: string, options?: { waitUntil: "networkidle" }): Promise<unknown>
  evaluate<T, A = undefined>(run: (arg: A) => T | Promise<T>, arg?: A): Promise<T>
  click(selector: string): Promise<void>
  waitForURL(url: string): Promise<void>
  waitForFunction<A>(run: (arg: A) => boolean, arg: A, options?: { timeout: number }): Promise<unknown>
  goBack(): Promise<unknown>
  goForward(): Promise<unknown>
  addInitScript(script: string): Promise<void>
}
type Context = { newPage(): Promise<Page>; close(): Promise<void> }
const {
  chromium,
}: {
  chromium: {
    launch(): Promise<{
      newContext(options: {
        viewport: { width: number; height: number }
        isMobile?: boolean
        hasTouch?: boolean
      }): Promise<Context>
      close(): Promise<void>
    }>
  }
} = await import(join(tmp, "node_modules/playwright/index.mjs"))

// Everything that should follow the language, read from the page.
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const text = (selector: string) =>
      [...document.querySelectorAll(selector)].map((element) => element.textContent?.trim() ?? "").join(" | ")
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      title: document.title,
      nav: text('[data-site] li[data-nav-id] [data-slot="label"]'),
      footer: text('[data-component="footer-columns"] h2, [data-component="footer-columns"] h3'),
    }
  })
type Snapshot = Awaited<ReturnType<typeof snapshot>>

const browser = await chromium.launch()
const failures: string[] = []
const compare = (where: string, actual: Snapshot, expected: Snapshot) =>
  (Object.keys(expected) as (keyof Snapshot)[])
    .filter((key) => actual[key] !== expected[key])
    .forEach((key) => failures.push(`${where} ${key}: "${actual[key]}", expected "${expected[key]}"`))

// What the server renders for each language, from a fresh load.
const reference = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const expected = Object.fromEntries(
  await Promise.all(
    ["ja", ...steps].map(async (locale) => {
      const page = await reference.newPage()
      await page.goto(`${base}/${locale}`, { waitUntil: "networkidle" })
      return [locale, await snapshot(page)] as const
    }),
  ),
)
await reference.close()

const devices = [
  {
    name: "desktop",
    options: { viewport: { width: 1440, height: 900 } },
    open: '[data-component="language-picker"] [data-slot="trigger"]',
    item: (locale: string) => `[data-component="language-picker"] [data-slot="dropdown"] a[href="/${locale}"]`,
  },
  {
    name: "phone",
    options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    open: '[data-component="language-picker"] [data-slot="trigger"]',
    item: (locale: string) => `a[data-slot="row"][href="/${locale}"]`,
  },
]
for (const device of devices) {
  const context = await browser.newContext(device.options)
  const page = await context.newPage()
  await page.goto(`${base}/ja`, { waitUntil: "networkidle" })
  for (const locale of steps) {
    await page.evaluate((selector) => {
      const trigger = [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.offsetParent)
      trigger?.click()
    }, device.open)
    await page.evaluate((selector) => document.querySelector<HTMLElement>(selector)?.click(), device.item(locale))
    await page.waitForURL(`${base}/${locale}`)
    await page.waitForFunction((lang) => document.documentElement.dataset.locale === lang, locale, { timeout: 5000 })
    compare(`${device.name} picker → ${locale}`, await snapshot(page), expected[locale])
  }
  await page.goBack()
  await page.waitForURL(`${base}/fr`)
  await page.waitForFunction(() => document.documentElement.dataset.locale === "fr", undefined, { timeout: 5000 })
  compare(`${device.name} back → fr`, await snapshot(page), expected.fr)
  await page.goForward()
  await page.waitForURL(`${base}/ar`)
  await page.waitForFunction(() => document.documentElement.dataset.locale === "ar", undefined, { timeout: 5000 })
  compare(`${device.name} forward → ar`, await snapshot(page), expected.ar)
  await context.close()
}

// A Design mode rename is English text: it shows in English and leaves other languages alone.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(`${base}/`, { waitUntil: "networkidle" })
await page.evaluate(() => {
  const key = "opencode-site-settings-v3"
  const saved = JSON.parse(localStorage.getItem(key) || "{}")
  localStorage.setItem(key, JSON.stringify({ ...saved, navConfig: [{ id: "docs", visible: true, label: "Handbook" }] }))
})
const docsLabel = () =>
  page.evaluate(() => document.querySelector('[data-site] li[data-nav-id="docs"] [data-slot="label"]')?.textContent)
const docsShown = () =>
  page.evaluate(() => {
    const item = document.querySelector('[data-site] li[data-nav-id="docs"]')!
    const label = item.querySelector<HTMLElement>('[data-slot="label"]')!
    const preload = item.querySelector<HTMLElement>('[data-slot="label-preload"]')!
    return getComputedStyle(label).display === "none"
      ? getComputedStyle(preload, "::before").content
      : label.textContent
  })
await page.goto(`${base}/`, { waitUntil: "networkidle" })
if ((await docsLabel()) !== "Handbook") failures.push(`renamed label in English: "${await docsLabel()}"`)
await page.goto(`${base}/es`, { waitUntil: "networkidle" })
const spanish = expected.es.nav.split(" | ")[0]
if ((await docsShown()) !== spanish) failures.push(`renamed label in Spanish: "${await docsShown()}"`)
await context.close()

await browser.close()
await rm(tmp, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`Not following the language:\n${failures.join("\n")}`)
  process.exit(1)
}
console.log("Every checked value follows the language.")
