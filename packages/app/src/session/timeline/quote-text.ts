/** About 5k tokens. */
export const QUOTE_MAX_LENGTH = 20_000

// Diff viewers render their lines in a shadow root.
const SHADOW_HOSTS = "diffs-container"

type Point = { node: Node; offset: number }

/** `range` is in the document; `start` and `end` may be inside a diff viewer's shadow root. */
export type TimelineSelection = { range: Range; start: Point; end: Point; backward: boolean }

/** The part of the current selection inside the timeline, including diff viewers. */
export function timelineSelection(selection: Selection, root: HTMLElement): TimelineSelection | undefined {
  if (selection.rangeCount === 0) return

  // Safari before 17 has no composed ranges.
  const composed =
    "getComposedRanges" in Selection.prototype
      ? selection.getComposedRanges({
          shadowRoots: [...root.querySelectorAll(SHADOW_HOSTS)].flatMap((host) =>
            host.shadowRoot ? [host.shadowRoot] : [],
          ),
        })[0]
      : selection.getRangeAt(0)

  if (!composed || composed.collapsed) return

  const range = document.createRange()
  const start = documentPoint({ node: composed.startContainer, offset: composed.startOffset }, false)
  const end = documentPoint({ node: composed.endContainer, offset: composed.endOffset }, true)
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)

  if (!range.intersectsNode(root)) return
  const content = document.createRange()
  content.selectNodeContents(root)
  const clampedStart = range.compareBoundaryPoints(Range.START_TO_START, content) < 0
  const clampedEnd = range.compareBoundaryPoints(Range.END_TO_END, content) > 0

  if (clampedStart) range.setStart(content.startContainer, content.startOffset)

  if (clampedEnd) range.setEnd(content.endContainer, content.endOffset)

  if (range.collapsed) return

  return {
    range,
    backward: backward(selection),
    start: clampedStart
      ? { node: range.startContainer, offset: range.startOffset }
      : { node: composed.startContainer, offset: composed.startOffset },
    end: clampedEnd
      ? { node: range.endContainer, offset: range.endOffset }
      : { node: composed.endContainer, offset: composed.endOffset },
  }
}

export function selectionRects(selection: TimelineSelection) {
  const outer = document.createRange()
  const start = documentPoint(selection.start, true)
  const end = documentPoint(selection.end, false)
  outer.setStart(start.node, start.offset)

  if (outer.comparePoint(end.node, end.offset) > 0) outer.setEnd(end.node, end.offset)

  return [outer, ...shadowRanges(selection)]
    .flatMap((range) => [...range.getClientRects()])
    .filter((rect) => rect.width > 0 && rect.height > 0)
}

/** The box of the character after a point, or before it with `before`. */
export function characterRect(point: Point, before: boolean) {
  if (!(point.node instanceof Text) || point.node.data.length === 0) return
  const offset = Math.min(Math.max(before ? point.offset - 1 : point.offset, 0), point.node.data.length - 1)
  const range = document.createRange()
  range.setStart(point.node, offset)
  range.setEnd(point.node, offset + 1)
  const rect = range.getBoundingClientRect()

  return rect.height > 0 ? rect : undefined
}

export function narrowSelection(selection: TimelineSelection, start: Point, end: Point): TimelineSelection {
  const range = document.createRange()
  const outerStart = documentPoint(start, false)
  const outerEnd = documentPoint(end, true)
  range.setStart(outerStart.node, outerStart.offset)
  range.setEnd(outerEnd.node, outerEnd.offset)

  return { range, start, end, backward: selection.backward }
}

export function shadowRanges(selection: TimelineSelection) {
  const hosts = selection.range.commonAncestorContainer

  const candidates =
    hosts instanceof Element || hosts instanceof DocumentFragment ? [...hosts.querySelectorAll(SHADOW_HOSTS)] : []

  return candidates.flatMap((host) =>
    host.shadowRoot && selection.range.intersectsNode(host) ? [innerRange(host.shadowRoot, selection)] : [],
  )
}

/**
 * The plain text of a selection in the timeline. The shell disables text selection and content opts back in, so only
 * selectable text is quoted; buttons, titles, and timestamps are left out.
 */
export function quoteText(selection: TimelineSelection) {
  const styles = new Map<Element, CSSStyleDeclaration>()

  const style = (element: Element) => {
    const cached = styles.get(element)

    if (cached) return cached

    const value = getComputedStyle(element)
    styles.set(element, value)

    return value
  }

  const selectable = new Map<Element, boolean>()

  // Not every browser resolves `user-select: auto` in computed style.
  const isSelectable = (element: Element): boolean => {
    const cached = selectable.get(element)

    if (cached !== undefined) return cached

    const value = style(element).userSelect || style(element).webkitUserSelect

    const result =
      value === "auto" ? (element.parentElement ? isSelectable(element.parentElement) : true) : value !== "none"

    selectable.set(element, result)

    return result
  }

  const blockOf = (element: Element): Element => {
    const display = style(element).display

    if (!display.startsWith("inline") && display !== "contents") return element

    return element.parentElement ? blockOf(element.parentElement) : element
  }

  const inlineSeparator = (previous: Element, current: Element) => {
    const item = itemOf(current, previous)
    const row = item.parentElement

    if (!row || item.contains(previous)) return

    if (style(item).display === "table-cell") return "\t"

    const display = style(row).display

    if ((display === "flex" || display === "inline-flex") && style(row).flexDirection.startsWith("row")) return " "
  }

  const output: string[] = []
  let length = 0
  let truncated = false
  let previous: { block: Element; part: Element | null } | undefined
  let first: Point | undefined
  let last: Point | undefined
  let left = Infinity
  let right = -Infinity

  const append = (value: string) => {
    output.push(value)
    length += value.length

    if (length > QUOTE_MAX_LENGTH) truncated = true
  }

  const endsWithBreak = () => {
    const last = output.at(-1)

    return last === undefined || last.endsWith("\n")
  }

  const separate = (separator: string) => {
    if (separator === "\n\n") append(endsWithBreak() ? "\n" : "\n\n")
    else if (!endsWithBreak()) append(separator)
  }

  const visit = (node: Text, range: Range) => {
    const parent = node.parentElement

    if (!parent || !isSelectable(parent) || style(parent).visibility !== "visible") return
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : (node.nodeValue?.length ?? 0)
    const raw = (node.nodeValue ?? "").slice(start, end)
    const pre = /^(pre|break-spaces)/.test(style(parent).whiteSpace)
    const text = pre ? raw : raw.replace(/\s+/g, " ")

    if (!text) return
    const current = { block: blockOf(parent), part: partOf(parent) }

    if (!pre && text === " ") {
      if (previous?.block === current.block && !endsWithBreak() && !output.at(-1)?.endsWith(" ")) append(" ")

      return
    }

    const starts = previous?.block !== current.block

    if (previous && current.part !== previous.part) separate("\n\n")
    else if (previous && starts) separate(inlineSeparator(previous.block, current.block) ?? "\n")
    previous = current
    append((starts ? marker(parent) : "") + (!pre && endsWithBreak() ? text.trimStart() : text))
    first ??= { node, offset: start + raw.search(/\S|$/) }
    last = { node, offset: start + raw.trimEnd().length }
    const piece = document.createRange()
    piece.setStart(node, start)
    piece.setEnd(node, end)

    for (const rect of piece.getClientRects()) {
      if (rect.width === 0) continue
      left = Math.min(left, rect.left)
      right = Math.max(right, rect.right)
    }
  }

  const walk = (range: Range) => {
    const root = range.commonAncestorContainer

    if (root instanceof Text) return visit(root, range)

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT

        if (node instanceof Text) return NodeFilter.FILTER_ACCEPT

        if (!(node instanceof Element)) return NodeFilter.FILTER_REJECT

        if (node.tagName === "BUTTON" || node.getAttribute("aria-hidden") === "true" || style(node).display === "none")
          return NodeFilter.FILTER_REJECT

        return node.tagName === "BR" || node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })

    while (!truncated && walker.nextNode()) {
      const node = walker.currentNode

      if (node instanceof Text) visit(node, range)
      else if (node instanceof Element && node.shadowRoot) walk(innerRange(node.shadowRoot, selection))
      else if (previous) append("\n")
    }
  }

  walk(selection.range)

  return {
    text: output
      .join("")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    truncated,
    first,
    last,
    horizontal: left < right ? { left, right } : undefined,
  }
}

// `Selection.direction` reads "none" for mouse selections in Chromium.
function backward(selection: Selection) {
  if (!selection.anchorNode || !selection.focusNode) return false
  const range = document.createRange()
  range.setStart(selection.anchorNode, selection.anchorOffset)

  return range.comparePoint(selection.focusNode, selection.focusOffset) < 0
}

function documentPoint(point: Point, end: boolean): Point {
  const root = point.node.getRootNode()

  if (!(root instanceof ShadowRoot)) return point
  const parent = root.host.parentNode!

  return documentPoint({ node: parent, offset: [...parent.childNodes].indexOf(root.host) + (end ? 1 : 0) }, end)
}

function innerRange(root: ShadowRoot, selection: TimelineSelection) {
  const range = document.createRange()
  range.selectNodeContents(root)

  if (root.contains(selection.start.node)) range.setStart(selection.start.node, selection.start.offset)

  if (root.contains(selection.end.node)) range.setEnd(selection.end.node, selection.end.offset)

  return range
}

function partOf(element: Element): Element | null {
  const part = element.closest("[data-timeline-part-id], [data-index]")

  if (part) return part
  const root = element.getRootNode()

  return root instanceof ShadowRoot ? partOf(root.host) : null
}

function itemOf(current: Element, previous: Element): Element {
  const parent = current.parentElement

  if (!parent || parent.contains(previous)) return current

  return itemOf(parent, previous)
}

function marker(element: Element) {
  const type = element.closest("[data-line-type]")?.getAttribute("data-line-type")

  if (type === "change-deletion") return "-"

  if (type === "change-addition") return "+"

  return ""
}
