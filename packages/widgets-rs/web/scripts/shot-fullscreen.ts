#!/usr/bin/env bun
// Opens one demo widget template in full screen and saves a screenshot: bun scripts/shot-fullscreen.ts <name> <out.png>
// (needs the demo server; run under xvfb-run for WebGPU canvases).
import { chromium } from "playwright-core"

const [name = "heatmap", out = "fullscreen.png"] = process.argv.slice(2)
const exe = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`
const browser = await chromium.launch({
  executablePath: exe,
  headless: !process.env.DISPLAY,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(`${process.env.DEMO ?? "http://localhost:4173/demo/"}?only=${name}`)
const w = page.locator(`.slot[data-name="${name}"] .psychoscript-widget`)
await w.locator(".pw-view > :not(.pw-loading)").first().waitFor({ timeout: 10000 })
await page.waitForTimeout(1500)
await w.hover()
await w.locator(".pw-expand").click()
await page.waitForFunction(() => document.fullscreenElement !== null, undefined, { timeout: 3000 })
// Away from the widget, so no hover state shows.
await page.mouse.move(640, 790)
await page.waitForTimeout(2500)
await page.screenshot({ path: out })
await browser.close()
console.log(out)
