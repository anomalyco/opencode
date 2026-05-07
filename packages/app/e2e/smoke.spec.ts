// FORK: web e2e smoke baseline — 验证 Playwright + vite dev server 链路通(2026-05-07)
//
// **本测试只证明"e2e 架子可用",不测业务逻辑**:
//   - vite dev server 能启起来(playwright.config.ts webServer 配置生效)
//   - chromium headless 能加载页面
//   - 页面 URL / 路由响应正常(http 200)
//
// **测不了什么**:
//   - 前端 UI 内容渲染 — web 版本依赖 opencode server(端口 4096),无 sidecar 时 body 为空
//   - 任何业务逻辑 — 文件树 / 设置面板 / 右键菜单等都需要 server fetch
//
// **后续接入路径(独立 backlog)**:
//   - 让 playwright.config.ts webServer 段同时启 opencode server(spawn sub-process)
//   - 或者前端加 mock mode,e2e 走 mock 数据不真连后端
//   - 通了之后,把 smoke.spec.ts 扩展成真正的业务测试(右键菜单 / 设置面板 / 切语言等)

import { test, expect } from "@playwright/test"

test("e2e 架子可用 — vite dev server + chromium 链路通", async ({ page }) => {
  const response = await page.goto("/")
  await page.waitForLoadState("domcontentloaded")

  // 1. HTTP 响应 OK(说明 dev server 启起来 + 路由匹配)
  expect(response).toBeTruthy()
  expect(response?.status()).toBeLessThan(500) // 200 / 304 都接受

  // 2. 页面是 HTML 文档(说明 vite SSR / serve 工作)
  const html = await page.content()
  expect(html).toContain("<html")
  expect(html).toContain("</html>")

  // 3. 控制台错误降级 — 记录但不 fail(无后端 server 时会有 fetch 错,这是预期)
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("[smoke] page console error:", msg.text())
    }
  })

  // 4. URL 正确(说明路由没意外重定向到 5xx 页面)
  expect(page.url()).toContain("127.0.0.1:3000")
})
