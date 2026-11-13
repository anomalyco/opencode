// Captures the flat stills script/og.ts angles into the link preview cards: real pages rendered
// headless in the dark theme, and a frame of the terminal feature clip with the blue themes dialog.
// The rest of the cards use files already in public/ (the product card covers and clips).
// Run by hand when a page's look changes, with the dev server up, from packages/console/app:
//   bun script/og-stills.ts [http://localhost:3011]
// Needs Playwright's Chromium (bunx playwright-core install chromium) and ffmpeg.
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright-core"

const root = path.resolve(import.meta.dir, "..")
const out = path.join(root, "src/asset/og")
const origin = process.argv[2] ?? "http://localhost:3011"

// A page, or a page scrolled to the section the card shows.
const pages = {
  home: "/",
  product: "/product",
  docs: "/docs",
  press: "/press#media",
  brand: "/brand#logo",
  font: "/font",
  changelog: "/changelog",
  release: "/changelog/v2.2.5",
  legal: "/legal",
  "privacy-policy": "/legal/privacy-policy",
  "terms-of-service": "/legal/terms-of-service",
}

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" })
for (const [name, route] of Object.entries(pages)) {
  await page.goto(origin + route, { waitUntil: "load" })
  const hash = new URL(origin + route).hash
  if (hash)
    await page
      .locator(hash)
      .first()
      .evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 40))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 85 })
  console.log(`og-stills: ${route}`)
}
await browser.close()

// The new TUI's blue themes dialog over a finished session (features/terminal-3, 60% in).
const clip = path.join(root, "public/product-videos/features/terminal-3.mp4")
Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-y", "-ss", "5.04", "-i", clip, "-frames:v", "1", "-q:v", "3", path.join(out, "terminal.jpg")])
console.log("og-stills: terminal dialog frame")
