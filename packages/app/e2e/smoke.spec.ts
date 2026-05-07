// FORK: web e2e smoke + mock 路径 — 验证 Playwright + mock server 链路通(2026-05-07)
//
// 第 1 笔(无 mock):只测链路通(HTTP / HTML / URL),body 为空因后端 fetch 卡住。
// 第 2 笔(本 — mock 路径):page.route 拦截 4096 所有请求返 200 空 JSON,前端能 render。
//
// 这是 V2 双清单 View 清单门槛生效的前置依赖建好了。

import { test, expect } from "./fixtures"

test("e2e 架子 baseline — vite dev server + chromium 链路通(无 mock)", async ({ page }) => {
  const response = await page.goto("/")
  await page.waitForLoadState("domcontentloaded")

  // 1. HTTP 响应 OK(说明 dev server 启起来 + 路由匹配)
  expect(response).toBeTruthy()
  expect(response?.status()).toBeLessThan(500)

  // 2. 页面是 HTML 文档
  const html = await page.content()
  expect(html).toContain("<html")
  expect(html).toContain("</html>")

  // 3. URL 正确
  expect(page.url()).toContain("127.0.0.1:3000")
})

test("e2e mock 路径可用 — 装 server mock 后前端能 render 出真实内容", async ({ mockedPage: page }) => {
  // 关键 console error 收集(non-fatal,但测试结束前打印便于调试)
  const consoleErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  // 等 SolidJS hydrate(不用 networkidle 因前端 SSE 持续 fetch 永远不 idle)
  await page.waitForTimeout(2000)

  // 装了 mock 后 body 应该有渲染内容(至少 root div 出来)
  const body = page.locator("body")
  await expect(body).toBeVisible()

  // 粗判:body 渲染长度 > 0(无 mock 时是 0)
  const bodyText = await body.innerText().catch(() => "")
  console.log(`[smoke-mock] body text length: ${bodyText.length}`)
  console.log(`[smoke-mock] body preview: ${bodyText.slice(0, 200)}`)
  console.log(`[smoke-mock] console errors: ${consoleErrors.length}`)
  if (consoleErrors.length > 0 && consoleErrors.length <= 5) {
    consoleErrors.forEach((e) => console.log(`  [err] ${e.slice(0, 120)}`))
  }

  // 验证 — mock 模式下应该比 baseline 多渲染内容
  expect(bodyText.length).toBeGreaterThan(0)
})
