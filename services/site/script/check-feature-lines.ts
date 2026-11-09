#!/usr/bin/env bun
// Checks that every feature description wraps to exactly two lines on a 16-inch MacBook Pro (a
// 1728px wide window): the home page's feature grid and the product pages' key features (the
// showcase row) and feature points. Run it
// after editing that copy, with the dev server running (default http://localhost:3011):
//   bun script/check-feature-lines.ts [base URL] [widths, comma-separated]
// Playwright installs into a temporary folder, so the app takes no dependency on it. Exits 1 when a
// description isn't two lines.
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

const base = process.argv[2] ?? "http://localhost:3011"
const widths = (process.argv[3] ?? "1728").split(",").map(Number)
const pages = ["/", "/desktop", "/mobile", "/terminal", "/sdk"]

const tmp = await mkdtemp(join(tmpdir(), "feature-lines-"))
await Bun.$`bun add playwright@1.57.0 && bunx playwright install chromium`.cwd(tmp).quiet()
// The few Playwright calls used here (the package isn't a dependency, so no types come with it).
type Page = {
  goto(url: string, options: { waitUntil: "networkidle" }): Promise<unknown>
  evaluate<T>(run: () => T | Promise<T>): Promise<T>
}
const {
  chromium,
}: {
  chromium: {
    launch(): Promise<{
      newContext(options: { viewport: { width: number; height: number } }): Promise<{
        newPage(): Promise<Page>
        close(): Promise<void>
      }>
      close(): Promise<void>
    }>
  }
} = await import(join(tmp, "node_modules/playwright/index.mjs"))

const browser = await chromium.launch()
const failures = (
  await Promise.all(
    widths.map(async (width) => {
      const context = await browser.newContext({ viewport: { width, height: Math.round(width * 0.646) } })
      const page = await context.newPage()
      const found: string[] = []
      for (const path of pages) {
        await page.goto(`${base}${path}?_device=macos`, { waitUntil: "networkidle" })
        await page.evaluate(() => document.fonts.ready)
        // Each description's line count: the distinct tops of its text's line boxes.
        const rows = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              "#home-features > li, [data-component='product-features'] > li, [data-component='showcase'] [data-slot='copy']",
            ),
          ].map((item) => {
            const body = item.querySelector(":scope > a > span, :scope > span, :scope > p")!
            const range = document.createRange()
            range.selectNodeContents(body)
            const tops = new Set(
              [...range.getClientRects()].filter((box) => box.width > 1).map((box) => Math.round(box.top)),
            )
            return { title: item.querySelector("strong, h3")!.textContent!.trim(), lines: tops.size }
          }),
        )
        console.log(`${width} ${path}: ${rows.length} descriptions`)
        found.push(
          ...rows.filter((row) => row.lines !== 2).map((row) => `${width} ${path} "${row.title}": ${row.lines} lines`),
        )
      }
      await context.close()
      return found
    }),
  )
).flat()
await browser.close()
await rm(tmp, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`Not two lines:\n${failures.join("\n")}`)
  process.exit(1)
}
console.log("Every feature description is two lines.")
