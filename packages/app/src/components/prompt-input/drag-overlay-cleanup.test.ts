// FORK: bug-repro 测试 — drop overlay 卡死修复
// [feat: chat-drop-overlay-stuck-fix] [bug-repro: 文件树拖文件到聊天窗口释放后浮层卡死] 2026-05-21
//
// 验证 attachments.ts 修法依赖的 DOM 事件流前置假设:
// ① 子元素(file-tree 行)在 bubble 阶段 stopPropagation 时,window-level capture 阶段 drop 仍 fire
//    → 兜底清浮层
// ② dragend 在 source 元素 dispatch,bubble 到 window
//    → 兜底覆盖 Esc 取消 / 拖到非 drop zone 等不发 drop 的场景

import { afterEach, describe, expect, test } from "bun:test"

describe("drag overlay cleanup (chat-drop-overlay-stuck-fix)", () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.()
  })

  test("child stopPropagation 不杀 window capture drop — 旧 bubble 监听会被杀,window capture 兜底仍触发", () => {
    let captureCount = 0
    let bubbleCount = 0

    const child = document.createElement("div")
    document.body.appendChild(child)
    cleanups.push(() => document.body.removeChild(child))

    // 模拟 file-tree row 的 onDrop(line 882-893 file-tree.tsx)
    const childHandler = (e: Event) => e.stopPropagation()
    child.addEventListener("drop", childHandler)
    cleanups.push(() => child.removeEventListener("drop", childHandler))

    // 模拟旧 attachments.ts(document bubble)— 会被 stopPropagation 杀
    const bubbleHandler = () => {
      bubbleCount++
    }
    document.addEventListener("drop", bubbleHandler)
    cleanups.push(() => document.removeEventListener("drop", bubbleHandler))

    // 模拟修复后 attachments.ts(window capture)— 不被 stopPropagation 杀
    const captureHandler = () => {
      captureCount++
    }
    window.addEventListener("drop", captureHandler, { capture: true })
    cleanups.push(() => window.removeEventListener("drop", captureHandler, { capture: true }))

    const ev = new Event("drop", { bubbles: true, cancelable: true })
    child.dispatchEvent(ev)

    // 修法核心断言:capture fire,bubble 被 child stopPropagation 杀
    expect(captureCount).toBe(1)
    expect(bubbleCount).toBe(0)
  })

  test("dragend 在 source 元素 fire 后能 bubble 到 window — 内部 drag 取消时兜底清状态", () => {
    let dragendCount = 0

    const source = document.createElement("div")
    document.body.appendChild(source)
    cleanups.push(() => document.body.removeChild(source))

    const windowHandler = () => {
      dragendCount++
    }
    window.addEventListener("dragend", windowHandler)
    cleanups.push(() => window.removeEventListener("dragend", windowHandler))

    // 模拟 file-tree 行 drag 取消(浏览器在 source 元素上 fire dragend)
    const ev = new Event("dragend", { bubbles: true })
    source.dispatchEvent(ev)

    expect(dragendCount).toBe(1)
  })

})
