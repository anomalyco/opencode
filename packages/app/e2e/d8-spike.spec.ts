// FORK: W2 D8 spike — 验证 mockProject + mockFileTree + preloadFile 能让 UI 进入"项目工作区"
// [feat: e2e-phase1-mock-mode] 2026-05-23
//
// 这是探路 spec,不是真示范用例 — 跑完看打印的 body text,判断后续 D12-D14 用例怎么写。
// 结论决定 W2 余下走向:
//   - 如果 UI 自动进入工作区 + 文件树渲染 → D10+ 写 fixture helpers 走 user flow 路径
//   - 如果卡在 "No projects open" → 看 mockProject 是不是没生效 / session 也要 mock
//   - 如果有 error → 看哪个 endpoint 未 mock

import { test, expect, installServerMock, mockProject, mockFileTree, preloadFile } from "./fixtures"

test("D8 spike — mockProject + mockFileTree 后 UI 进入啥状态", async ({ page }) => {
  // 先装 specific routes(后注册按 Playwright reverse-order 应 first match,但实测 catch-all 先抢)
  // 改用:先装 specific,最后装 catch-all 兜底 — 这样 catch-all 一定后注册 → 不抢 specific
  // 监听 4096 端口实际请求 URL — 判断 SDK 走的真实路径
  const serverRequests: string[] = []
  page.on("request", (req) => {
    const url = req.url()
    if (url.includes(":4096")) {
      serverRequests.push(`${req.method()} ${url.replace(/^http:\/\/[^/]+/, "")}`)
    }
  })

  // catch-all 先(兜底),specific 后(Playwright last-first match → 抢)
  await installServerMock(page)
  await mockProject(page, {
    id: "e2e-mock-project",
    worktree: "/mock/workspace",
    vcs: undefined,
    time: { created: Date.now() },
  })

  await page.goto("/")
  // SolidJS hydrate
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)

  // 这步必须在 hydrate 后(否则 window.__deskfoxE2eMemfs 还没挂)
  await mockFileTree(page, {
    "notes.md": "# Test\n\nold content",
    "src/main.ts": "console.log('hi')",
    "src/util.ts": "export const x = 1",
  })
  await preloadFile(page, "notes.md", "# Test\n\nold content")

  // 给 UI 时间响应 project mock
  await page.waitForTimeout(2000)

  const body = await page.locator("body").innerText()
  console.log("[D8 spike] body length:", body.length)
  console.log("[D8 spike] body preview (first 800 chars):")
  console.log(body.slice(0, 800))

  // 错误探测
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`)
  })
  await page.waitForTimeout(500)
  console.log("[D8 spike] errors during interaction:", errors.length)
  for (const e of errors) console.log("  ", e)

  // 检测一些关键 UI 元素
  const noProjects = await page.locator('text="No projects open"').count()
  const openProject = await page.locator('text="Open project"').count()
  const fileTree = await page.locator('[class*="file-tree"], [class*="FileTree"], nav').count()
  console.log("[D8 spike] indicator counts — noProjects:", noProjects, "openProject:", openProject, "fileTree-ish:", fileTree)

  console.log("[D8 spike] 4096 server requests (first 30):")
  for (const r of serverRequests.slice(0, 30)) console.log("  ", r)
  console.log(`[D8 spike] total ${serverRequests.length} server requests`)

  // spike spec — 不强 assert,主要看 console.log 输出
  expect(body.length).toBeGreaterThan(0)
})
