// RTL detection and application utilities for mixed-script text rendering.
// See https://github.com/anomalyco/opencode/issues/35319 for the underlying
// problem this addresses: without these helpers, paragraphs that mix RTL
// (Arabic, Hebrew, Persian, Urdu) and LTR (Latin) scripts render in the wrong
// visual order and align to the left of their container.

const RTL_RANGE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0780-\u07BF\u07C0-\u07FF\u0800-\u083F\u0840-\u085F\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/
const FIRST_STRONG_REGEX = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/

export function detectDirection(text: string): "rtl" | "ltr" | null {
  const match = text.match(FIRST_STRONG_REGEX)
  if (!match) return null
  return RTL_RANGE.test(match[0]) ? "rtl" : "ltr"
}

// Sets dir="auto" on every block-level container that owns a direct text
// node starting with a strong character. Block ancestors are detected by
// walking up the tree until `display` is no longer inline-like, mirroring
// the algorithm in issue #35319.
export function applyAutoDirection(root: ParentNode): void {
  const elements = root.querySelectorAll<HTMLElement>("p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, td, th, figcaption, summary")
  elements.forEach((el) => {
    if (el.closest("pre, code, kbd, samp, textarea")) return
    const text = directText(el)
    if (!text) return
    const dir = detectDirection(text)
    if (dir && el.getAttribute("dir") !== "auto") el.setAttribute("dir", "auto")
  })
}

// Flips table column order by setting dir on the table element based on its
// first strong character. This is the only place where an explicit dir
// (rather than dir="auto") is safe, because column ordering for tables
// requires a known base direction.
export function applyTableDirection(root: ParentNode): void {
  const tables = root.querySelectorAll<HTMLTableElement>("table")
  tables.forEach((table) => {
    if (table.closest("pre, code")) return
    const dir = detectDirection((table.textContent ?? "").trim())
    if (!dir) return
    if (table.getAttribute("dir") !== dir) table.setAttribute("dir", dir)
  })
}

function directText(el: Element): string {
  let out = ""
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && node.nodeValue) out += node.nodeValue
  }
  return out.trim()
}
