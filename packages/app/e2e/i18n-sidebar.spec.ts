// FORK: i18n sidebar 空状态 e2e — 验证 i18n drift 补全后 sidebar.empty.* 渲染正确 2026-05-07
//
// 这是 V2 双清单 View 清单的"i18n 间接 e2e"实证 — 装 mock 后前端进入空状态,
// sidebar.empty.title / sidebar.empty.description 应该有 i18n 文案渲染。
//
// 当前默认 locale fallback 到 en(无 user config 时),所以测英文文案。
// 后续可扩 zh / zht 切换 e2e(等用户能进设置面板的路径打通)。

import { test, expect } from "./fixtures"

test("默认 locale (en):sidebar 空状态显示 i18n 英文文案", async ({ mockedPage: page }) => {
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000) // SolidJS hydrate

  // sidebar.empty.title = "No projects open"(可能 sidebar 内 + content 内重复 — 用 first)
  await expect(page.getByText("No projects open").first()).toBeVisible()
  // sidebar.empty.description = "Open a project to get started"
  await expect(page.getByText("Open a project to get started").first()).toBeVisible()
})

test("sidebar.gettingStarted 段:免费模型介绍文案", async ({ mockedPage: page }) => {
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)

  await expect(page.getByText("Getting started").first()).toBeVisible()
  await expect(page.getByText(/free models/i).first()).toBeVisible()
})

test("无 fatal console error(全 mock 网络环境)", async ({ mockedPage: page }) => {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`)
  })

  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)

  // 严格断言 — 0 fatal error(SolidJS 渲染失败 / 未捕获异常都会进 console.error 或 pageerror)
  expect(errors).toEqual([])
})
