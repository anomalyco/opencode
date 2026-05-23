// FORK: Phase 1 e2e mock foundation — 端到端 smoke 验证
// [feat: e2e-phase1-mock-mode] 2026-05-23 W3 D17
//
// 这是 Phase 1 e2e 基础设施的"最终验证 spec" — 覆盖以下完整链路:
//   1. Vite mock plugin alias @tauri-apps/api/core → e2e/mocks/tauri.ts(W1 D2)
//   2. memfs 内存文件系统跨进程通过 window.__deskfoxE2eMemfs(W2 D8)
//   3. Tauri invoke dispatch 22 命令(W1 D4-D6)
//   4. fixture override 表(W3 D17)— spec 注入特定 invoke 行为
//   5. bootstrap mock 4 query + SSE catch-all(W3 D15)
//   6. workspace 进入 + 文件树 render(W3 D16)
//
// 不走完整 user flow click(那是 follow-up sprint 范围),验 mock infra 自洽即可。
// 完整业务示范用例(auto-save / chat-drop / large-file-preview 完整版)留待 Phase 1 跑稳后专项 sprint。

import {
  test,
  expect,
  installServerMock,
  bootstrapMock,
  mockFileTree,
  preloadFile,
  setMockFileSize,
  resetMemfs,
} from "./fixtures"

test("Phase 1 mock foundation — bootstrap + workspace + memfs + override 全链路", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`)
  })

  // === 1. mock 装载顺序:catch-all 先,specific 后(Playwright last-first match)===
  await installServerMock(page)
  await bootstrapMock(page)

  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2500)

  // === 2. 验 bootstrap 完成,UI ready ===
  const initialBody = await page.locator("body").innerText()
  expect(initialBody).toContain("/mock/workspace")
  expect(initialBody).toContain("Recent projects")

  // === 3. 进入工作区 ===
  await page.locator('text="/mock/workspace"').first().click()
  await page.waitForTimeout(2000)
  const workspaceBody = await page.locator("body").innerText()
  expect(workspaceBody).toContain("All files")

  // === 4. 验 memfs 跨进程注入 + Tauri invoke dispatch ===
  await resetMemfs(page)
  await mockFileTree(page, {
    "notes.md": "# Hello\nMock content",
    "big.txt": "x", // 实际 1 byte,size 用 override 伪装
  })
  await preloadFile(page, "notes.md", "# Hello\nMock content")

  // 验 Tauri invoke get_file_size 返 memfs 实际值
  const realSize = await page.evaluate(async () => {
    const w = window as unknown as { __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<number> }
    return await w.__deskfoxE2eInvoke("get_file_size", { root: "", path: "notes.md" })
  })
  console.log("[smoke] real notes.md size:", realSize)
  expect(realSize).toBeGreaterThan(10) // utf8 byte length of "# Hello\nMock content"

  // === 5. 验 override 表 — spec 注入巨大值 ===
  await setMockFileSize(page, "big.txt", 200 * 1024 * 1024) // 200 MB
  const overrideSize = await page.evaluate(async () => {
    const w = window as unknown as { __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<number> }
    return await w.__deskfoxE2eInvoke("get_file_size", { root: "", path: "big.txt" })
  })
  console.log("[smoke] override big.txt size:", overrideSize)
  expect(overrideSize).toBe(200 * 1024 * 1024)

  // === 6. 验 write_text_file + mtime 自增 ===
  await page.evaluate(async () => {
    const w = window as unknown as { __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<unknown> }
    await w.__deskfoxE2eInvoke("write_text_file", { root: "", path: "notes.md", content: "updated" })
  })
  const newMtime = await page.evaluate(async () => {
    const w = window as unknown as { __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<number> }
    return await w.__deskfoxE2eInvoke("get_file_mtime", { root: "", path: "notes.md" })
  })
  console.log("[smoke] notes.md new mtime:", newMtime)
  expect(newMtime).toBeGreaterThan(0)

  // === 7. 验 memfs.read 拿到新内容(write 后) ===
  const updatedContent = await page.evaluate(() => {
    const w = window as unknown as {
      __deskfoxE2eMemfs?: { read(p: string): { content: string } | null }
    }
    return w.__deskfoxE2eMemfs?.read("notes.md")?.content
  })
  expect(updatedContent).toBe("updated")

  // === 8. 验 write_text_file mtime 冲突检测 ===
  const conflictResult = await page.evaluate(async () => {
    const w = window as unknown as { __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<unknown> }
    try {
      await w.__deskfoxE2eInvoke("write_text_file", {
        root: "",
        path: "notes.md",
        content: "wrong-mtime-test",
        expectedMtime: 1, // 故意给错的 mtime
      })
      return "no_error"
    } catch (e) {
      return (e as Error).message
    }
  })
  console.log("[smoke] mtime conflict result:", conflictResult)
  expect(conflictResult).toContain("mtime_conflict")

  console.log("[smoke] errors collected:", errors.length)
  // 允许 SSE / queryFn skipToken 警告,不要 fatal page error
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("event stream") &&
      !e.includes("ERR_CONNECTION_REFUSED") &&
      !e.includes("FETCH-FALSY-REJECTION") &&
      !e.includes("skipToken"),
  )
  console.log("[smoke] fatal errors:", fatalErrors.length)
  for (const e of fatalErrors) console.log("  ", e)
  expect(fatalErrors.length).toBe(0)
})
