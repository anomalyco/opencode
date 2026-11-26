#!/usr/bin/env bun
// Loads the demo in headless Chromium and prints console errors and the log. Usage: bun scripts/smoke.ts [query]
import { chromium } from "playwright-core"

const exe = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`
// Headful under Xvfb (xvfb-run) with SwiftShader's Vulkan: headless screenshots leave WebGPU canvases blank.
const browser = await chromium.launch({
  executablePath: exe,
  headless: !process.env.DISPLAY,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
page.on("console", (m) => console.log(`[console.${m.type()}]`, m.text()))
page.on("pageerror", (e) => console.log("[pageerror]", e.message, e.stack?.split("\n").slice(0, 4).join(" / ")))
page.on("response", (r) => { if (r.status() >= 400) console.log("[http]", r.status(), r.url()) })
await page.goto(`http://localhost:4173/demo/${process.argv[2] ?? ""}`)
await page.waitForTimeout(Number(process.argv[3] ?? 3000))
console.log(JSON.stringify(await page.evaluate(() => (window as any).__demo.log), null, 1))
console.log(JSON.stringify(await page.evaluate(() => (window as any).__demo.perWidget)))
await page.screenshot({ path: "/home/exedev/services/opencode-agent/agent-state/agent-root/artifacts/widgets/" + (process.env.SHOT ?? "smoke") + ".png", fullPage: false })
await browser.close()
