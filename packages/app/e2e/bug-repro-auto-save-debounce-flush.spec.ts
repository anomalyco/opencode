// FORK: bug-repro spec — auto-save-debounce-flush (Phase 1 spec A4 落地,D1 降级路径)
// [feat: e2e-bug-repro-3case] [bug-repro: auto-save 自写后误弹"AI 修改了此文件"toast] 2026-05-23
//
// 复现 / 守护场景:`auto-save-debounce-flush` feat 的 markSelfWriting 500ms 窗口
//   ① auto-save 写盘后 watcher.file.edited 触发
//   ② 没 markSelfWriting 防护时 → 误识别为外部 AI 修改 → 弹"AI 修改了此文件"toast(false alarm)
//   ③ 修法:saveEditCore({silent:true}) 调 markSelfWriting(p),notifyDirtyConflict 在窗口内 return
//
// 测试策略(D1 降级路径,见 1-spec):
//   不戳 CodeMirror 真打字 — 走 invoke write_text_file 直驱(模拟 auto-save 落盘的本质动作)。
//   验:① write 完 memfs 含新内容 ② mtime 自增 ③ 无 dirtyConflict toast 在 DOM。
//
// 不覆盖(本 case 范围外,留待 follow-up):
//   - 完整 CodeMirror 打字 + 1s debounce 触发
//   - 切 tab flush 实景(<Show keyed> onCleanup)
//   - markSelfWriting 反向用例(无 mark 时 toast 该弹)— Phase 1 mock SSE 不真触发 watcher event,
//     反向验证需 SDK event listen 桥接,留 Phase 2 真桌面 e2e 或 follow-up sprint

import {
  test,
  expect,
  installServerMock,
  bootstrapMock,
  mockFileTree,
  preloadFile,
} from "./fixtures"

test("[bug-repro: auto-save-debounce-flush] write_text_file via invoke → memfs 同步 + mtime 自增 + 0 误 toast", async ({ page }) => {
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

  // 准备 note.md(memfs preload 在 click 前,文件树才能渲染)
  await mockFileTree(page, {
    "note.md": "initial content",
  })
  await preloadFile(page, "note.md", "initial content")

  await page.locator('text="/mock/workspace"').first().click()
  await page.waitForTimeout(2500)

  // 验初始状态:memfs 含 note.md 原内容
  const initial = await page.evaluate(async () => {
    const w = window as unknown as {
      __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<unknown>
    }
    const size = await w.__deskfoxE2eInvoke("get_file_size", { root: "", path: "note.md" })
    const mtime = await w.__deskfoxE2eInvoke("get_file_mtime", { root: "", path: "note.md" })
    return { size, mtime }
  })
  expect(typeof initial.mtime).toBe("number")
  expect((initial.mtime as number) > 0).toBe(true)

  // === 模拟 auto-save 落盘 — 走 invoke write_text_file ===
  await page.evaluate(async () => {
    const w = window as unknown as {
      __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<unknown>
    }
    await w.__deskfoxE2eInvoke("write_text_file", {
      root: "",
      path: "note.md",
      content: "edited by auto-save",
    })
  })

  // === 验 ① memfs 含新内容 ===
  const afterWrite = await page.evaluate(() => {
    const w = window as unknown as {
      __deskfoxE2eMemfs?: { read(p: string): { content: string; mtime: number } | null }
    }
    return w.__deskfoxE2eMemfs?.read("note.md") ?? null
  })
  expect(afterWrite).not.toBeNull()
  expect(afterWrite!.content).toBe("edited by auto-save")

  // === 验 ② mtime 自增 ===
  expect(afterWrite!.mtime).toBeGreaterThan(initial.mtime as number)

  // === 验 ③ DOM 中没有"AI 修改了此文件"toast(不论中/英文)===
  // 给 reactive 链 1s 缓冲让 SSE / event 链路有机会触发(如果会触发的话)
  await page.waitForTimeout(1000)
  const dirtyConflictToast = await page
    .locator('text=/AI 修改了此文件|AI modified this file|AI 修改了此檔案/')
    .count()
  console.log("[auto-save] dirtyConflict toast count:", dirtyConflictToast)
  expect(dirtyConflictToast).toBe(0)

  // === 验 ④ mtime 冲突检测仍工作(回归保护)===
  const conflictResult = await page.evaluate(async () => {
    const w = window as unknown as {
      __deskfoxE2eInvoke: (cmd: string, args: unknown) => Promise<unknown>
    }
    try {
      await w.__deskfoxE2eInvoke("write_text_file", {
        root: "",
        path: "note.md",
        content: "stale-write-test",
        expectedMtime: 1, // 故意给错的 mtime
      })
      return "no_error"
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(conflictResult).toContain("mtime_conflict")

  // 无 fatal page error
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("event stream") &&
      !e.includes("ERR_CONNECTION_REFUSED") &&
      !e.includes("FETCH-FALSY-REJECTION") &&
      !e.includes("skipToken"),
  )
  if (fatalErrors.length > 0) {
    console.log("[auto-save] fatal errors:")
    for (const e of fatalErrors) console.log("  ", e)
  }
  expect(fatalErrors.length).toBe(0)
})
