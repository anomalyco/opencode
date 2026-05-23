// FORK: bug-repro spec — chat-drop-overlay-stuck-fix (Phase 1 spec A5 落地)
// [feat: e2e-bug-repro-3case] [bug-repro: drag 文件后浮层卡死无法关闭] 2026-05-23
//
// 复现 / 守护场景:`chat-drop-overlay-stuck-fix` feat 的 window 级 capture-phase 兜底
//   ① file-tree 行 onDrop 调 stopPropagation 杀掉 document bubble drop
//   ② 浮层 setDraggingType(null) 不执行 → overlay 卡死显示 border-dashed
//   ③ 修法:attachments.ts onMount 注册 window-level `drop` capture + `dragend` 监听
//   ④ capture-phase 在 bubble 之前 fire,免疫 stopPropagation
//
// 测试方法:dispatchEvent 模拟 dragover(border-dashed 出现)→ dispatch drop 带 stopPropagation 闸
// (mimic file-tree row 行为)→ 验 border-dashed 消失。

import {
  test,
  expect,
  installServerMock,
  bootstrapMock,
} from "./fixtures"

test("[bug-repro: chat-drop-overlay-stuck-fix] dragover 激活浮层 → drop+stopPropagation → 浮层 capture-phase 兜底清除", async ({ page }) => {
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

  // 进 workspace → prompt-input 在项目落地页就已挂载,不需要进 session
  await page.locator('text="/mock/workspace"').first().click()
  await page.waitForTimeout(2500)

  // 基线:border-dashed 不应该存在(没拖动)
  const baseline = await page.locator(".border-dashed").count()
  console.log("[baseline] border-dashed count:", baseline)
  expect(baseline).toBe(0)

  // === 模拟 1:dragover with Files type → 期望 setDraggingType("image")激活 overlay ===
  await page.evaluate(() => {
    const dt = new DataTransfer()
    const file = new File(["x"], "test.txt", { type: "text/plain" })
    dt.items.add(file)
    document.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(300)

  const afterDragover = await page.locator(".border-dashed").count()
  console.log("[after dragover] border-dashed count:", afterDragover)
  expect(afterDragover).toBeGreaterThan(0) // overlay 激活

  // === 模拟 2:drop 在子元素 + stopPropagation 杀 bubble(模拟 file-tree row 行为)===
  // 关键 bug:bubble drop 被杀 → document "drop" listener 不 fire → setDraggingType(null) 不执行
  // 修法:window 级 capture-phase drop listener,在 bubble 之前 fire,免疫 stopPropagation
  await page.evaluate(() => {
    const target = document.body // 任意子元素即可,关键是 stopPropagation
    const killer = (e: Event) => e.stopPropagation()
    target.addEventListener("drop", killer, false) // bubble 阶段
    const dt = new DataTransfer()
    const file = new File(["x"], "test.txt", { type: "text/plain" })
    dt.items.add(file)
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }))
    target.removeEventListener("drop", killer, false)
  })
  await page.waitForTimeout(300)

  const afterDrop = await page.locator(".border-dashed").count()
  console.log("[after drop+stopPropagation] border-dashed count:", afterDrop)
  expect(afterDrop).toBe(0) // 浮层应被 capture-phase 兜底清除

  // 无 fatal page error
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("event stream") &&
      !e.includes("ERR_CONNECTION_REFUSED") &&
      !e.includes("FETCH-FALSY-REJECTION") &&
      !e.includes("skipToken"),
  )
  if (fatalErrors.length > 0) {
    console.log("[chat-drop] fatal errors:")
    for (const e of fatalErrors) console.log("  ", e)
  }
  expect(fatalErrors.length).toBe(0)
})
