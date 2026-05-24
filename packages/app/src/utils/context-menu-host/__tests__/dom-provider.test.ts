// FORK: DomSelectionProvider 单测 [feat: office-选中加聊天] 2026-05-24
//
// 覆盖三块:
// 1. matches() — chat-log / pdf-viewer / 非接管区 / target 在 textLayer 内的 closest 兜底
// 2. getSelection() — 无 range / 空 text / 有效选区 / partial(跨 PDF 页)
// 3. spansMultiplePdfPages() — 单页 / 跨页 / 无 .pdf-page-wrapper
// 4. clear() — 清原生 selection

import { afterEach, describe, expect, test } from "bun:test"
import { DomSelectionProvider, DOM_PROVIDER_SELECTORS } from "../dom-provider"

const provider = new DomSelectionProvider()

const cleanup = () => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
}

describe("DOM_PROVIDER_SELECTORS", () => {
  test("v1 范围只含 chat-log 与 pdf-viewer 两个 selector(MD viewer 留 v2)", () => {
    expect(DOM_PROVIDER_SELECTORS).toEqual([
      '[data-slot="session-turn-list"]',
      '[data-slot="pdf-viewer"]',
    ])
  })
})

describe("DomSelectionProvider.matches", () => {
  afterEach(cleanup)

  test("target 在 chat-log 子树内返 true", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "session-turn-list")
    const child = document.createElement("span")
    child.textContent = "hi"
    root.appendChild(child)
    document.body.appendChild(root)
    expect(provider.matches(child)).toBe(true)
  })

  test("target 在 pdf-viewer 子树内返 true", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "pdf-viewer")
    const inner = document.createElement("div")
    inner.className = "textLayer"
    const span = document.createElement("span")
    span.textContent = "pdf-text"
    inner.appendChild(span)
    root.appendChild(inner)
    document.body.appendChild(root)
    expect(provider.matches(span)).toBe(true)
  })

  test("target 在非接管区返 false(file-tree / composer / md-viewer 等)", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "md-viewer") // v1 不接管 MD viewer
    const span = document.createElement("span")
    span.textContent = "md"
    root.appendChild(span)
    document.body.appendChild(root)
    expect(provider.matches(span)).toBe(false)
  })

  test("target 是接管区本身(closest 命中自己)返 true", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "session-turn-list")
    document.body.appendChild(root)
    expect(provider.matches(root)).toBe(true)
  })

  test("游离节点(未 attach 到 document)在非接管区返 false", () => {
    const orphan = document.createElement("div")
    expect(provider.matches(orphan)).toBe(false)
  })
})

describe("DomSelectionProvider.getSelection", () => {
  afterEach(cleanup)

  test("无 rangeCount 返空 SelectionResult", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "session-turn-list")
    document.body.appendChild(root)
    window.getSelection()?.removeAllRanges()
    const result = provider.getSelection(root)
    expect(result).not.toBeNull()
    expect(result!.text).toBe("")
    expect(result!.rects).toEqual([])
    expect(result!.range).toBeNull()
  })

  test("有 range 但 toString().trim() 为空 → 空 SelectionResult", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "session-turn-list")
    const span = document.createElement("span")
    span.textContent = "   " // 纯空白
    root.appendChild(span)
    document.body.appendChild(root)

    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    const result = provider.getSelection(root)
    expect(result!.text).toBe("")
    expect(result!.range).toBeNull()
  })

  test("有效选区 → text 非空 + range 非 null + partial=undefined(chat 区)", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "session-turn-list")
    const span = document.createElement("span")
    span.textContent = "hello world"
    root.appendChild(span)
    document.body.appendChild(root)

    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    const result = provider.getSelection(root)
    expect(result!.text).toBe("hello world")
    expect(result!.range).not.toBeNull()
    // chat 区不做跨页检测,partial 应为 false/undefined
    expect(result!.partial === true).toBe(false)
  })

  test("pdf-viewer 区单页选区 → partial=false", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "pdf-viewer")
    const page = document.createElement("div")
    page.className = "pdf-page-wrapper"
    const span = document.createElement("span")
    span.textContent = "single page text"
    page.appendChild(span)
    root.appendChild(page)
    document.body.appendChild(root)

    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    const result = provider.getSelection(span)
    expect(result!.text).toBe("single page text")
    expect(result!.partial === true).toBe(false)
  })

  test("pdf-viewer 区跨页选区 → partial=true(Step 4 toast 兜底依赖)", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "pdf-viewer")
    const page1 = document.createElement("div")
    page1.className = "pdf-page-wrapper"
    const s1 = document.createElement("span")
    s1.textContent = "page-1-text"
    page1.appendChild(s1)
    const page2 = document.createElement("div")
    page2.className = "pdf-page-wrapper"
    const s2 = document.createElement("span")
    s2.textContent = "page-2-text"
    page2.appendChild(s2)
    root.appendChild(page1)
    root.appendChild(page2)
    document.body.appendChild(root)

    const range = document.createRange()
    range.setStart(s1.firstChild!, 0)
    range.setEnd(s2.firstChild!, s2.textContent!.length)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    const result = provider.getSelection(s1)
    expect(result!.text.length).toBeGreaterThan(0)
    expect(result!.partial).toBe(true)
  })
})

describe("DomSelectionProvider.spansMultiplePdfPages", () => {
  afterEach(cleanup)

  const setupPages = (count: number) => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "pdf-viewer")
    const spans: HTMLSpanElement[] = []
    for (let i = 0; i < count; i++) {
      const page = document.createElement("div")
      page.className = "pdf-page-wrapper"
      const span = document.createElement("span")
      span.textContent = `page-${i}-text`
      page.appendChild(span)
      root.appendChild(page)
      spans.push(span)
    }
    document.body.appendChild(root)
    return { root, spans }
  }

  test("单页选区返 false", () => {
    const { spans } = setupPages(3)
    const range = document.createRange()
    range.selectNodeContents(spans[0])
    expect(provider.spansMultiplePdfPages(range)).toBe(false)
  })

  test("跨 2 页选区返 true", () => {
    const { spans } = setupPages(3)
    const range = document.createRange()
    range.setStart(spans[0].firstChild!, 0)
    range.setEnd(spans[1].firstChild!, spans[1].textContent!.length)
    expect(provider.spansMultiplePdfPages(range)).toBe(true)
  })

  test("跨 3 页选区返 true", () => {
    const { spans } = setupPages(3)
    const range = document.createRange()
    range.setStart(spans[0].firstChild!, 0)
    range.setEnd(spans[2].firstChild!, spans[2].textContent!.length)
    expect(provider.spansMultiplePdfPages(range)).toBe(true)
  })

  test("无 .pdf-page-wrapper 节点返 false(chat 区直接调到此 helper 的兜底)", () => {
    const root = document.createElement("div")
    root.setAttribute("data-slot", "session-turn-list")
    const span = document.createElement("span")
    span.textContent = "chat-text"
    root.appendChild(span)
    document.body.appendChild(root)

    const range = document.createRange()
    range.selectNodeContents(span)
    expect(provider.spansMultiplePdfPages(range)).toBe(false)
  })

  test("只有 1 个 .pdf-page-wrapper 时返 false(早退)", () => {
    const { spans } = setupPages(1)
    const range = document.createRange()
    range.selectNodeContents(spans[0])
    expect(provider.spansMultiplePdfPages(range)).toBe(false)
  })
})

describe("DomSelectionProvider.clear", () => {
  afterEach(cleanup)

  test("清当前 window selection", () => {
    const root = document.createElement("div")
    const span = document.createElement("span")
    span.textContent = "to-clear"
    root.appendChild(span)
    document.body.appendChild(root)

    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    expect(sel.rangeCount).toBe(1)

    provider.clear()
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  test("无 selection 时 noop", () => {
    expect(() => provider.clear()).not.toThrow()
  })
})

describe("providerName", () => {
  test("providerName = 'dom'(debug toast 等场合标识)", () => {
    expect(provider.providerName).toBe("dom")
  })
})
