type WindowFind = Window & {
  find?: (
    query: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrap?: boolean,
    wholeWord?: boolean,
    searchInFrames?: boolean,
    showDialog?: boolean,
  ) => boolean
}

export function findInPage(query: string, dir?: 1 | -1) {
  const q = query.trim()
  if (!q) return

  const found = (window as WindowFind).find?.(q, false, dir === -1, true, false, false, false)
  if (found) requestAnimationFrame(revealCurrentSelection)
  return found
}

function revealCurrentSelection() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  const rect = selectedRect(range)
  if (!rect) return

  const scroller = nearestScroller(range.commonAncestorContainer)
  if (!scroller) return

  revealRect(scroller, rect)
}

function selectedRect(range: Range) {
  const rects = Array.from(range.getClientRects())
  const rect = rects.find((item) => item.width > 0 || item.height > 0) ?? range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  return rect
}

function nearestScroller(node: Node) {
  let element = node instanceof Element ? node : node.parentElement

  while (element) {
    if (element instanceof HTMLElement && scrollable(element)) return element
    element = element.parentElement
  }

  const root = document.scrollingElement
  return root instanceof HTMLElement && scrollable(root) ? root : undefined
}

function scrollable(element: HTMLElement) {
  const style = getComputedStyle(element)
  const y = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
  const x = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1
  return y || x
}

function revealRect(scroller: HTMLElement, rect: DOMRect) {
  const bounds = scroller.getBoundingClientRect()
  const padding = 56

  if (rect.top < bounds.top + padding) {
    scroller.scrollTop -= bounds.top + padding - rect.top
  } else if (rect.bottom > bounds.bottom - padding) {
    scroller.scrollTop += rect.bottom - (bounds.bottom - padding)
  }

  if (rect.left < bounds.left + padding) {
    scroller.scrollLeft -= bounds.left + padding - rect.left
  } else if (rect.right > bounds.right - padding) {
    scroller.scrollLeft += rect.right - (bounds.right - padding)
  }
}
