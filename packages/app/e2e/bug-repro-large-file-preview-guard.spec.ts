// FORK: bug-repro spec — large-file-preview-guard (Phase 1 spec A6 落地)
// [feat: e2e-bug-repro-3case] [bug-repro: 大文件预览统一防护 — 100MB+ 文件应渲染 FileTooLarge 卡] 2026-05-23
//
// 复现 / 守护场景:`large-file-preview-guard` feat L1 入口闸门 + L4 UX 兜底
//   ① context/file.tsx load() 调 invoke get_file_size,超 SIZE_LIMITS 设 state.tooLarge
//   ② file-tabs.tsx 看到 tooLarge 渲染 <FileTooLarge>,显示文件名 + 类型/大小/阈值 + 2 按钮
//
// 用 setMockFileSize override 把 huge.txt 伪装成 100MB(text 类阈值 10MB,必触发)。
// 验文案 "文件过大,跳过预览" + 两个按钮 "用本机软件打开" / "打开所在文件夹"。

import {
  test,
  expect,
  installServerMock,
  bootstrapMock,
  mockFileTree,
  setMockFileSize,
} from "./fixtures"

test("[bug-repro: large-file-preview-guard] 100MB+ .txt → FileTooLarge 卡 + 2 按钮渲染", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`)
  })

  await installServerMock(page)
  await bootstrapMock(page)

  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000)

  // 关键:file-list HTTP query 在 workspace click 时就发,必须在 click 之前注册 mockFileTree 路由
  // + 预填 memfs(否则 query hit 时 memfs 空 → list 返 [] → 文件树渲染 "No files")
  await mockFileTree(page, {
    "small.txt": "tiny content",
    "huge.txt": "x", // 实 1 byte,size 用 override 伪装
  })
  // override get_file_size 让 huge.txt 看起来 100MB(text 阈值 10MB,必超)
  await setMockFileSize(page, "huge.txt", 100 * 1024 * 1024)

  // 进 workspace — file.list query 此时发,命中已注册的 mockFileTree 路由
  await page.locator('text="/mock/workspace"').first().click()
  await page.waitForTimeout(3000)

  // 点击 huge.txt 节点(file-tree 行渲染为 <button>,含文件名 text)
  await page.locator('button:has-text("huge.txt")').first().click()
  await page.waitForTimeout(1500)

  // === 验 FileTooLarge 卡渲染 ===
  // 标题文案
  await expect(page.locator('text="文件过大,跳过预览"')).toBeVisible()
  // 文件路径出现在卡内
  await expect(page.locator('text=huge.txt').first()).toBeVisible()
  // 两个动作按钮
  await expect(page.getByRole('button', { name: '用本机软件打开' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开所在文件夹' })).toBeVisible()

  // 无 fatal page error(允许 SSE / skipToken 兼容噪音,对照 mock-foundation 黑名单)
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("event stream") &&
      !e.includes("ERR_CONNECTION_REFUSED") &&
      !e.includes("FETCH-FALSY-REJECTION") &&
      !e.includes("skipToken"),
  )
  if (fatalErrors.length > 0) {
    console.log("[large-file] fatal errors:")
    for (const e of fatalErrors) console.log("  ", e)
  }
  expect(fatalErrors.length).toBe(0)
})
