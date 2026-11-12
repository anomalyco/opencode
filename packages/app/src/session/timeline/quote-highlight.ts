import { createEffect, onCleanup } from "solid-js"
import type { QuoteSource, createComposerQuoteSource } from "@/composer/quote-source"
import { createQuoteBackground } from "./quote-background"

const BASE = "timeline-quote-source"

/** Capture exact offsets in stable parts, rather than finding the first occurrence of the quoted text. */
export function captureQuoteSource(ranges: Range[]): QuoteSource {
  const indexes = new Map<Element, Map<Text, number>>()

  return ranges.reduce<QuoteSource>((sources, range) => {
    const node = range.startContainer
    const root = node.getRootNode()
    const parent = node.parentElement
    const part = (root instanceof ShadowRoot ? root.host : parent)?.closest("[data-timeline-part-id]")
    const partID = part?.getAttribute("data-timeline-part-id")
    const revealID = part?.closest("[data-message-id]")?.getAttribute("data-message-id")

    if (!part || !partID || !revealID || !parent || !(node instanceof Text)) return sources
    const body = parent.closest('[data-slot="text-part-body"], [data-slot="user-message-text"]')
    const line = root instanceof ShadowRoot ? parent.closest("[data-line][data-line-type]") : undefined
    const container = root instanceof ShadowRoot ? line : (body ?? part)

    if (!container) return sources
    const index = indexes.get(container) ?? new Map(textNodes(container).map((item) => [item.node, item.start]))
    indexes.set(container, index)
    const offset = index.get(node)

    if (offset === undefined) return sources

    const source = {
      partID,
      revealID,
      body: body ? `[data-slot="${body.getAttribute("data-slot")}"]` : undefined,
      shadow:
        root instanceof ShadowRoot && line
          ? {
              host: [...part.querySelectorAll("diffs-container")].indexOf(root.host),
              line: `[data-line="${CSS.escape(line.getAttribute("data-line")!)}"][data-line-type="${CSS.escape(line.getAttribute("data-line-type")!)}"]`,
            }
          : undefined,
      start: offset + range.startOffset,
      end: offset + range.endOffset,
      text: range.toString(),
    }

    const previous = sources.at(-1)

    // Token spans and inline formatting are contiguous text within the same source container.
    if (
      previous &&
      previous.partID === source.partID &&
      previous.body === source.body &&
      previous.shadow?.host === source.shadow?.host &&
      previous.shadow?.line === source.shadow?.line &&
      previous.end === source.start
    ) {
      previous.end = source.end
      previous.text += source.text

      return sources
    }

    sources.push(source)

    return sources
  }, [])
}

export function createTimelineQuoteHighlight(input: {
  root: () => HTMLElement | undefined
  source: () => ReturnType<typeof createComposerQuoteSource>
  enabled: () => boolean
}) {
  createEffect(() => {
    const root = input.root()
    const source = input.source()
    const key = source.state.pending
    const pieces = key ? source.state.sources[key] : undefined

    if (!root || !input.enabled() || !key || !pieces?.length) return
    const base = typeof Highlight !== "undefined" && CSS.highlights ? new Highlight() : undefined

    if (base) {
      base.priority = -2
      CSS.highlights.set(BASE, base)
    }

    let frame: number | undefined
    const background = createQuoteBackground()
    const observed = new Set<Element>()

    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        apply()
      })
    }

    const apply = () => {
      base?.clear()
      observer.disconnect()
      const shadows = new Set<ShadowRoot>()
      const containers = new Map<Element, ReturnType<typeof textNodes>>()
      const ranges: Range[] = []

      pieces.forEach((piece) => {
        const range = resolveQuoteRange(root, piece, containers, (shadow) => {
          if (shadows.has(shadow)) return
          shadows.add(shadow)
        })

        if (!range) return

        base?.add(range)
        ranges.push(range)
      })
      background.update(ranges)
      observer.observe(root, { childList: true, subtree: true, characterData: true })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "dir"] })
      shadows.forEach((shadow) => observer.observe(shadow, { childList: true, subtree: true, characterData: true }))

      const targets = new Set<Element>([root, ...containers.keys()])

      observed.forEach((element) => {
        if (targets.has(element)) return
        resize.unobserve(element)
        observed.delete(element)
      })
      targets.forEach((element) => {
        if (observed.has(element)) return
        observed.add(element)
        resize.observe(element)
      })
    }

    const observer = new MutationObserver(schedule)
    const resize = new ResizeObserver(schedule)
    document.fonts.addEventListener("loadingdone", schedule)
    window.addEventListener("resize", schedule)

    apply()
    onCleanup(() => {
      observer.disconnect()
      resize.disconnect()
      document.fonts.removeEventListener("loadingdone", schedule)
      window.removeEventListener("resize", schedule)

      if (frame !== undefined) cancelAnimationFrame(frame)
      background.clear()

      if (base) CSS.highlights.delete(BASE)
    })
  })
}

function resolveQuoteRange(
  root: HTMLElement,
  piece: QuoteSource[number],
  containers: Map<Element, ReturnType<typeof textNodes>>,
  observe?: (shadow: ShadowRoot) => void,
) {
  const part = root.querySelector(`[data-timeline-part-id="${CSS.escape(piece.partID)}"]`)
  const shadow = piece.shadow && part?.querySelectorAll("diffs-container")[piece.shadow.host]?.shadowRoot

  if (shadow) observe?.(shadow)

  const container = piece.shadow
    ? shadow?.querySelector(piece.shadow.line)
    : piece.body
      ? part?.querySelector(piece.body)
      : part

  if (!container) return
  const nodes = containers.get(container) ?? textNodes(container)
  containers.set(container, nodes)
  const start = nodes.find((item) => item.start <= piece.start && item.end > piece.start)
  const end = nodes.find((item) => item.start < piece.end && item.end >= piece.end)

  if (!start || !end) return
  const range = document.createRange()
  range.setStart(start.node, piece.start - start.start)
  range.setEnd(end.node, piece.end - end.start)

  // A changed tool result or rerender must never highlight unrelated text at the old offset.
  return range.toString() === piece.text ? range : undefined
}

function textNodes(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number; end: number }[] = []
  let offset = 0

  while (walker.nextNode()) {
    // SAFETY: SHOW_TEXT restricts this walker to Text nodes.
    const node = walker.currentNode as Text
    nodes.push({ node, start: offset, end: offset + node.length })
    offset += node.length
  }

  return nodes
}
