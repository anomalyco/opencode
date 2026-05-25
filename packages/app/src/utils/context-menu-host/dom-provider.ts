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
    const inPdfViewer = target.closest('[data-slot="pdf-viewer"]') != null

    // FORK: PDF/office 走"视觉 bbox 内 spans"算法,避开 pdf.js textLayer DOM 顺序 ≠ 视觉顺序导致
    // 复杂 box/表格内容漏字的问题。CDP 实测:史料题 PDF 漏 212/364 字(60%),docx 漏 29/346 字(8%)。
    // 跟 message-part chat 区原生选区不冲突 — chat 区走老路径。
    // [feat: office-选中加聊天] 2026-05-25
    if (inPdfViewer) {
      const visual = this.collectVisualSpansInBbox(target, range)
      if (visual) {
        const partial = this.spansMultiplePdfPages(range)
        return { text: visual.text, rects: visual.rects, range, partial }
      }
      // 视觉算法 fallback(罕见 — 拿不到 bbox 或无 spans)→ 走 native
    }

    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0,
    )
    const partial = inPdfViewer && this.spansMultiplePdfPages(range)
    return { text: raw, rects, range, partial }
  }

  /**
   * 视觉 bbox 算法:取 native selection 的视觉边界 bbox,在 pdf-viewer 容器内找所有
   * textLayer span 中心在 bbox y 范围内的 spans,按视觉顺序(top→bottom, left→right)拼接。
   *
   * Why:pdf.js textLayer 把 PDF text stream 按渲染顺序铺成 spans,**DOM 顺序 ≠ 视觉顺序**
   * (复杂 PDF 含 box/表格/图表时严重)。浏览器 native selection 沿 DOM 顺序扩展,导致视觉中间
   * 但 DOM 顺序外的 spans 被跳过(user 看到"中间字没底色")。
   *
   * 我们的算法:把"选区在哪"用视觉 bbox 表达,不依赖 DOM 顺序。
   *
   * 返回 { text, rects } — text 拼好的视觉顺序字符串,rects 给 host 红色 overlay 画(让 user
   * 看到完整选区视觉,补 native 蓝色高亮的漏字)。返回 null 表示无法计算(pdf-viewer 不存在 / 无 spans)。
   */
  private collectVisualSpansInBbox(
    target: Element,
    range: Range,
  ): { text: string; rects: DOMRect[] } | null {
    const pdfViewer = target.closest('[data-slot="pdf-viewer"]')
    if (!pdfViewer) return null

    // native selection 的视觉边界(union of all client rects)
    const nativeRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0,
    )
    if (nativeRects.length === 0) return null
    let bboxTop = Infinity
    let bboxBottom = -Infinity
    for (const r of nativeRects) {
      if (r.top < bboxTop) bboxTop = r.top
      if (r.bottom > bboxBottom) bboxBottom = r.bottom
    }
    if (!Number.isFinite(bboxTop) || !Number.isFinite(bboxBottom)) return null

    // 找 pdf-viewer 子树内所有 textLayer spans,过滤中心 y 在 bbox 内
    // 注:**不过滤 whitespace-only spans** — pdf.js textLayer 用 " " span 表词间空格,
    // 过滤掉就造成红色 overlay 间"天窗"(user 2026-05-25 实测漏 22 个空格 spans 截图反馈)
    const allSpans = pdfViewer.querySelectorAll<HTMLSpanElement>(".textLayer span")
    type Hit = { el: HTMLSpanElement; rect: DOMRect; cy: number }
    const hits: Hit[] = []
    allSpans.forEach((el) => {
      const t = el.textContent
      if (!t) return // 空 textContent(只 br/嵌套元素)跳过
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const cy = rect.top + rect.height / 2
      if (cy < bboxTop || cy > bboxBottom) return
      hits.push({ el, rect, cy })
    })
    if (hits.length === 0) return null

    // 按视觉位置排序 — top 优先(误差 5px 内视作同行),然后 left 升序
    hits.sort((a, b) => {
      if (Math.abs(a.rect.top - b.rect.top) > 5) return a.rect.top - b.rect.top
      return a.rect.left - b.rect.left
    })

    // 拼文本 — 同行 spans 之间无分隔(whitespace spans 自带 " "),跨行加 \n
    let text = ""
    let prevTop: number | null = null
    for (const h of hits) {
      if (prevTop !== null && Math.abs(h.rect.top - prevTop) > 5) {
        text += "\n"
      }
      text += h.el.textContent || ""
      prevTop = h.rect.top
    }

    const rects = hits.map((h) => h.rect)
    return { text, rects }
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
