// FORK: 基于 window.getSelection() 的 SelectionProvider 实现
// [feat: office-选中加聊天] 2026-05-24
//
// 覆盖 v1 两处:chat(session-turn-list)+ PDF/office(PdfViewer 容器,内含 PDF.js textLayer)。
// MD viewer 留 v2 跟 CodeMirror 一起做 — 见 1-spec § 范围限定。

import type { SelectionProvider, SelectionResult } from "./provider"

/**
 * v1 管辖区域。按出现位置匹配 `target.closest(selector)`。
 *
 * 与 mdMenu(file-tabs.tsx,handles `data-html-preview` iframe / MD viewer 等)互不重叠 —
 * Host capture 阶段先收到,匹配则 preventDefault;不匹配则继续冒泡到 mdMenu light DOM 处理。
 */
export const DOM_PROVIDER_SELECTORS = [
  '[data-slot="session-turn-list"]', // chat 对话区
  '[data-slot="pdf-viewer"]',         // PDF / office(走 PDF.js textLayer)
] as const

/** PDF.js textLayer 每页的容器类名(`pdf.tsx:205` 设置)。跨页选区检测靠它。 */
const PDF_PAGE_WRAPPER_CLASS = "pdf-page-wrapper"

export class DomSelectionProvider implements SelectionProvider {
  readonly providerName = "dom"

  matches(target: Element): boolean {
    return DOM_PROVIDER_SELECTORS.some((sel) => target.closest(sel) != null)
  }

  getSelection(target: Element): SelectionResult | null {
    if (typeof window === "undefined") return null
    const sel = window.getSelection()
    if (!sel) return null

    // 无选区或选区跨度为 0 → 返回空 text 让 Host 仍开菜单(disabled 状态)
    if (sel.rangeCount === 0) {
      return { text: "", rects: [], range: null }
    }

    const raw = sel.toString()
    if (!raw.trim()) {
      return { text: "", rects: [], range: null }
    }

    const range = sel.getRangeAt(0).cloneRange()
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0,
    )

    // 跨页选区检测仅对 pdf-viewer 区域有意义(chat 区域无 .pdf-page-wrapper)
    const inPdfViewer = target.closest('[data-slot="pdf-viewer"]') != null
    const partial = inPdfViewer && this.spansMultiplePdfPages(range)

    return { text: raw, rects, range, partial }
  }

  /**
   * 判定 range 是否跨越多个 PDF.js 页 wrapper。
   *
   * 用法:Host 在 partial=true 时显示"请分段选中"提示 + disable "添加到聊天"。
   * PDF.js 懒渲染(IntersectionObserver, rootMargin 800px),未进入视窗附近的页 textLayer
   * 不存在,window.getSelection().toString() 拿到的内容不完整 — 这是不能给 LLM 的。
   *
   * v1 toast 提示分段;v2 看用户痛点是否触发"强制渲染 + 等 Promise + 重读 selection"升级。
   */
  spansMultiplePdfPages(range: Range): boolean {
    // 从 commonAncestorContainer 向上找最近的能 query 的元素
    const ancestor = range.commonAncestorContainer
    const el =
      ancestor.nodeType === Node.ELEMENT_NODE
        ? (ancestor as Element)
        : ancestor.parentElement
    if (!el) return false

    // 从 ancestor 向上找到包含所有 .pdf-page-wrapper 的祖先(PdfViewer 容器)
    // 简化:直接在 ancestor 子树里找 — 若 range 跨 2 页,commonAncestor 必然是 PdfViewer 容器
    const pages = el.querySelectorAll(`.${PDF_PAGE_WRAPPER_CLASS}`)
    if (pages.length <= 1) return false

    let count = 0
    pages.forEach((p) => {
      if (range.intersectsNode(p)) count++
      // 早退:确认 >1 就够了
    })
    return count > 1
  }

  clear(): void {
    if (typeof window === "undefined") return
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      // 罕见情况:节点已 detach / selection API 抛错 — 忽略
    }
  }
}
