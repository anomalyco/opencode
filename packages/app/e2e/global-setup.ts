// FORK: Playwright e2e globalSetup — vite mock 冷启动 warmup
// [feat: e2e-vite-warmup] 2026-05-23
//
// 解决:vite mock dev server 冷启动 + Playwright 多 worker 并行 → 第 1 批 2-3 spec
// 在 hydrate 等待中超 60s test timeout(`mock-foundation` + `bug-repro-chat-drop-overlay`
// 2026-05-23 整合远端 5 commit 后跑全套撞到)。
//
// 方案 A:跑测试前用真 chromium 加载 `/` 一次,让 vite 编完所有 SolidJS 组件树 + module deps,
// 实际测试启动时所有模块已 cache,瞬间 hydrate。
//
// 配合方案 D(`vite/e2e-mock.js` server.warmup.clientFiles)双保险 — vite 启动时预测式编一批,
// globalSetup 真浏览器再扫一遍兜底未覆盖的 module。

import { chromium, type FullConfig } from "@playwright/test"

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:3000"
  const start = Date.now()
  console.log(`[e2e globalSetup] vite warmup — fetch ${baseURL}/ via chromium`)

  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    // networkidle 等所有 module 请求安静下来(typical 冷启动 5-10s)
    await page.goto(baseURL + "/", { waitUntil: "networkidle", timeout: 60_000 })
    // 额外 1.5s 让 SolidJS createEffect / queueMicrotask 链路稳
    await page.waitForTimeout(1500)
  } finally {
    await page.close()
    await browser.close()
  }

  console.log(`[e2e globalSetup] vite warmup done in ${Date.now() - start}ms`)
}
