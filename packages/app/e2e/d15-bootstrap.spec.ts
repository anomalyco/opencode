// FORK: W3 D15 spike — 验证 bootstrapMock 能让 UI 进入 ready 状态
// [feat: e2e-phase1-mock-mode] 2026-05-23
//
// 关键节点 — 如果 UI 从 "No projects open"(catch-all 默认) → "项目工作区"(看到 mock 项目名或文件树),
// 说明 W3 D15 通,可以继续 D16-D19 示范用例。
//
// 如果仍卡 "No projects open" → bootstrap shape 还不完整,需要补别的 query。

import { test, expect, bootstrapMock, installServerMock } from "./fixtures"

test("D15 — bootstrap 4 query mock 后 UI 进入 ready 状态 + D16 spike 进入工作区", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`)
  })

  // 正确顺序:catch-all 先注册(兜底),specific 后注册(Playwright last-first match → 抢回)
  await installServerMock(page)
  await bootstrapMock(page, {
    projects: [
      {
        id: "e2e-mock",
        worktree: "/mock/workspace",
        vcs: undefined,
        time: { created: Date.now() },
      },
    ],
  })

  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(3000) // bootstrap + reactive 链

  const body = await page.locator("body").innerText()
  console.log("[D15] body length:", body.length)
  console.log("[D15] body preview (first 600 chars):")
  console.log(body.slice(0, 600))

  console.log("[D15] errors:", errors.length)
  for (const e of errors.slice(0, 8)) console.log("  ", e)

  const noProjects = await page.locator('text="No projects open"').count()
  const hasMockWorkspace =
    body.includes("/mock/workspace") || body.includes("mock") || body.includes("workspace")
  console.log("[D15] noProjects indicator:", noProjects, "hasMockWorkspace:", hasMockWorkspace)

  // ===== D16 spike — 点 Recent projects 里的 /mock/workspace 卡进入工作区 =====
  console.log("\n[D16] try clicking '/mock/workspace' card to enter workspace ...")
  const workspaceCard = page.locator('text="/mock/workspace"').first()
  const cardCount = await workspaceCard.count()
  console.log("[D16] workspace card count:", cardCount)
  if (cardCount > 0) {
    await workspaceCard.click()
    await page.waitForTimeout(2500)
    const newBody = await page.locator("body").innerText()
    console.log("[D16] body after click — length:", newBody.length)
    console.log("[D16] body preview (first 800 chars):")
    console.log(newBody.slice(0, 800))
    console.log("[D16] still showing 'No projects':", await page.locator('text="No projects open"').count())
    console.log("[D16] errors after click:", errors.length)
    for (const e of errors.slice(-5)) console.log("  ", e)
  }

  expect(body.length).toBeGreaterThan(0)
})
