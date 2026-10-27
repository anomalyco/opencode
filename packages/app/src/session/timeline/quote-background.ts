type Rect = { left: number; top: number; right: number; bottom: number }

/** Native selection fills line boxes; custom highlights only fill the smaller font boxes. */
export function createQuoteBackground() {
  const hosts = new Map<HTMLElement, { layer: HTMLSpanElement; relative: boolean }>()

  const remove = (parent: HTMLElement) => {
    const host = hosts.get(parent)

    if (!host) return
    host.layer.remove()
    parent.classList.remove("timeline-quote-highlight-host")

    if (host.relative) parent.classList.remove("timeline-quote-highlight-relative")
    hosts.delete(parent)
  }

  return {
    update(ranges: Range[]) {
      const styles = new Map<Element, CSSStyleDeclaration>()
      const boxes = new Map<Element, DOMRect>()
      const lines = new Map<HTMLElement, Rect[]>()

      const style = (element: Element) => {
        const value = styles.get(element) ?? getComputedStyle(element)
        styles.set(element, value)

        return value
      }

      ranges.forEach((range) => {
        const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)

        const visit = (node: Node) => {
          const parent = node.parentElement

          if (!(parent instanceof HTMLElement) || !range.intersectsNode(node)) return
          const piece = document.createRange()
          piece.setStart(node, node === range.startContainer ? range.startOffset : 0)
          piece.setEnd(node, node === range.endContainer ? range.endOffset : node.textContent!.length)
          const block = lineBlock(parent, style)
          const height = parseFloat(style(block).lineHeight)
          const box = boxes.get(block) ?? block.getBoundingClientRect()
          boxes.set(block, box)
          const top = box.top + parseFloat(style(block).borderTopWidth) + parseFloat(style(block).paddingTop)

          const rects = [...piece.getClientRects()].flatMap((rect) => {
            if (!rect.width || !rect.height) return []

            const y =
              Number.isFinite(height) && height >= rect.height
                ? top + Math.floor((rect.top + rect.height / 2 - top) / height) * height
                : rect.top

            return [{ left: rect.left, right: rect.right, top: y, bottom: y + Math.max(height || 0, rect.height) }]
          })

          if (!rects.length) return
          const current = lines.get(parent) ?? []
          current.push(...rects)
          lines.set(parent, current)
        }

        if (range.commonAncestorContainer instanceof Text) return visit(range.commonAncestorContainer)

        while (walker.nextNode()) visit(walker.currentNode)
      })

      hosts.forEach((_host, parent) => {
        if (!lines.has(parent)) remove(parent)
      })
      lines.forEach((_rects, parent) => {
        const existing = hosts.get(parent)

        // A renderer can replace a retained element's textContent, removing its background child.
        if (existing) {
          if (existing.layer.parentElement !== parent) parent.append(existing.layer)

          return
        }

        const layer = document.createElement("span")
        layer.dataset.component = "timeline-quote-background"
        layer.setAttribute("aria-hidden", "true")
        const relative = style(parent).position === "static"
        parent.classList.add("timeline-quote-highlight-host")

        if (relative) parent.classList.add("timeline-quote-highlight-relative")
        parent.append(layer)
        hosts.set(parent, { layer, relative })
      })

      // Inline containing blocks can start at their first fragment, not their bounding box's left edge.
      const origins = new Map([...hosts].map(([parent, host]) => [parent, host.layer.getBoundingClientRect()]))
      lines.forEach((rects, parent) => {
        const host = hosts.get(parent)!
        const origin = origins.get(parent)!

        const merged = rects
          .sort((a, b) => a.top - b.top || a.left - b.left)
          .reduce<Rect[]>((result, rect) => {
            const previous = result.at(-1)

            if (
              previous &&
              Math.abs(previous.top - rect.top) < 0.5 &&
              Math.abs(previous.bottom - rect.bottom) < 0.5 &&
              rect.left <= previous.right + 0.5
            ) {
              previous.right = Math.max(previous.right, rect.right)

              return result
            }

            result.push({ ...rect })

            return result
          }, [])

        host.layer.replaceChildren(
          ...merged.map((rect) => {
            const element = document.createElement("span")
            element.style.left = `${rect.left - origin.left}px`
            element.style.top = `${rect.top - origin.top}px`
            element.style.width = `${rect.right - rect.left}px`
            element.style.height = `${rect.bottom - rect.top}px`

            return element
          }),
        )
      })
    },
    clear: () => hosts.forEach((_host, parent) => remove(parent)),
  }
}

function lineBlock(element: HTMLElement, style: (element: Element) => CSSStyleDeclaration): HTMLElement {
  if (!/^(inline|contents)$/.test(style(element).display) || !element.parentElement) return element

  return lineBlock(element.parentElement, style)
}
