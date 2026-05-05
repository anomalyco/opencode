// [fork-only] .md 导出 PDF — 走浏览器原生 window.print() + 系统 print 对话框
// [feat: md-export-pdf-word] 2026-05-05
//
// 为什么不用 jsPDF / html2canvas:
// - 中文字体丢失(库默认输出 PDF 里中文显示成方框)
// - mermaid SVG 转 canvas 有损,代码块易切割
// - 包体积 +500 KB(库 + 字体)
// 系统 print 对话框 → "另存为 PDF" 由 OS 处理,中文 / mermaid / shiki 颜色 100% 保留,
// 用户还能调页边距 / 横竖向 / 选页码,代价仅多 1 步选 PDF。

import { showToast } from "@opencode-ai/ui/toast"

const PRINT_STYLE_ID = "deskfox-md-print-style"

// 动态注入 @media print CSS:
// - 隐藏不该进 PDF 的 UI(侧边栏 / 文件树 / 标签栏 / chrome)
// - 强制保留代码块 / callout 底色(浏览器 print 默认省墨)
// - viewer 占满纸张宽度
// - 代码块 / callout 尽量不分页
const PRINT_CSS = `
@media print {
  /* 隐藏全局 chrome */
  [data-component="sidebar"],
  [data-component="header"],
  [data-component="status-bar"],
  [data-component="filetree"],
  aside#review-panel:not(:has([data-context="file-viewer"])),
  [data-component="prompt-input"] {
    display: none !important;
  }

  /* 强制保留底色(浏览器 print 默认省墨,代码块 / callout 颜色会丢) */
  [data-context="file-viewer"],
  [data-context="file-viewer"] * {
    print-color-adjust: exact !important;
    -webkit-print-color-adjust: exact !important;
  }

  /* viewer 占满纸张 */
  [data-context="file-viewer"] {
    width: 100% !important;
    max-width: none !important;
    padding: 0 !important;
  }

  /* 代码块 / callout / 表格 尽量不跨页切割 */
  [data-component="markdown"] pre,
  [data-component="markdown"] .markdown-alert,
  [data-component="markdown"] table {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* 标题尽量跟正文一起(防孤儿标题) */
  [data-component="markdown"] h1,
  [data-component="markdown"] h2,
  [data-component="markdown"] h3 {
    page-break-after: avoid;
    break-after: avoid;
  }
}
`

let printStyleInjected = false
function injectPrintStyles() {
  if (printStyleInjected) return
  if (document.getElementById(PRINT_STYLE_ID)) {
    printStyleInjected = true
    return
  }
  const style = document.createElement("style")
  style.id = PRINT_STYLE_ID
  style.textContent = PRINT_CSS
  document.head.appendChild(style)
  printStyleInjected = true
}

/** 打开系统 print 对话框,用户选"另存为 PDF"完成导出 */
export const exportMdAsPdf = (opts: { hintText: string }) => {
  injectPrintStyles()
  showToast({ variant: "default", title: opts.hintText })
  // 等 toast 渲染 + 用户读到提示(~700ms),再弹 print 对话框
  setTimeout(() => window.print(), 700)
}
