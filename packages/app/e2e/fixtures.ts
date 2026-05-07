// FORK: e2e 测试 fixture — 拦截 opencode server 请求让前端能 render 起来 2026-05-07
//
// 当前 e2e 没启 opencode server(端口 4096),前端 fetch 会卡 / 失败。
// Playwright page.route 拦截 4096 所有 HTTP 请求 + WebSocket,返回 200 / 空 JSON,
// 让前端 startup 流程能走完,e2e 测纯 UI 行为。
//
// 这是 V2 双清单(governance v2)View 清单"等 e2e 基础设施 setup"的第 1 步实现。
// 不依赖 opencode-cli sidecar,跑得快(纯 mock)。
//
// 限制:
// - 只测 UI 渲染 / 路由 / 表单 / 静态行为,不测真实后端联调
// - 后续如需测真后端逻辑,可加"真实 sidecar"模式作为补充(独立 backlog)

import { test as base, expect, type Page } from "@playwright/test"

const SERVER_HOST = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const SERVER_PORT = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const SERVER_PATTERN = `**://${SERVER_HOST}:${SERVER_PORT}/**`

/** 给 page 装上 mock — 拦截所有 opencode server 请求返 200 空 JSON */
export async function installServerMock(page: Page): Promise<void> {
  await page.route(SERVER_PATTERN, (route) => {
    const url = route.request().url()
    const method = route.request().method()
    // GET /health -> 200 ok
    if (url.includes("/health")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", mock: true }),
      })
    }
    // GET 列表类(sessions / projects / providers / models 等)→ 空数组
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], items: [], mock: true }),
      })
    }
    // POST / PUT / DELETE → 200 + ok
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mock: true }),
    })
  })

  // WebSocket 连接 — Playwright 拦截不了 WS 直接,但我们用 webSocket 路由(if any)
  // 实际 opencode 用 SSE / fetch streaming,不是 WS。这块先空。
}

// 扩展 base test,自动装 mock(测试可选用)
export const test = base.extend<{ mockedPage: Page }>({
  mockedPage: async ({ page }, use) => {
    await installServerMock(page)
    await use(page)
  },
})

export { expect }
