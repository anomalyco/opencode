import { clearCache, layout, measureNaturalWidth, prepare, type PreparedText } from "@chenglou/pretext"
import {
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineItem,
} from "@chenglou/pretext/rich-inline"

/** Resolved CSS values, read when the viewport's typography changes, never once per row. */
export type TimelineTypography = {
  family: string
  codeFamily: string
  codeInset: number
  codeLineHeight: number
  rem: number
  size: number
  weight: number
  medium: number
  bold: number
  lineHeight: number
  letterSpacing: number
  revision: number
}

export type TimelineRowLayout =
  | { source: "pretext" | "fixed"; height: number }
  | { source: "dom"; reason: string; blocks?: number[] }

export type TimelineLayoutEnvironment = {
  width: number
  desktop: boolean
  typography: TimelineTypography
}

export function readTimelineTypography(element: Element, revision: number): TimelineTypography {
  const style = getComputedStyle(element)
  const size = parseFloat(style.getPropertyValue("--font-size-base"))
  const leading = style.getPropertyValue("--line-height-large").trim()
  // Resolve CSS chrome once with typography. Browsers snap a .5px border differently;
  // this empty style probe reads no content geometry and never measures a timeline row.
  const probe = document.createElement("div")
  probe.dataset.component = "markdown"
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none"
  const code = document.createElement("pre")
  code.className = "highlights"
  probe.append(code)
  element.append(probe)
  const chrome = getComputedStyle(code)

  const codeInset = [chrome.paddingTop, chrome.paddingBottom, chrome.borderTopWidth, chrome.borderBottomWidth].reduce(
    (sum, value) => sum + parseFloat(value),
    0,
  )

  const codeLineHeight = parseFloat(chrome.lineHeight) || 20
  probe.remove()

  return {
    family: style.getPropertyValue("--font-family-sans").trim(),
    codeFamily: style.getPropertyValue("--font-family-mono").trim(),
    codeInset,
    codeLineHeight,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    size,
    weight: parseFloat(style.getPropertyValue("--font-weight-regular")),
    medium: parseFloat(style.getPropertyValue("--font-weight-medium")),
    bold: parseFloat(style.getPropertyValue("--font-weight-bold")),
    lineHeight: leading.endsWith("%") ? (size * parseFloat(leading)) / 100 : parseFloat(leading),
    letterSpacing: parseFloat(style.getPropertyValue("--letter-spacing-normal")) || 0,
    revision,
  }
}

/** The cache belongs to a session renderer. Width is deliberately absent from preparation keys. */
export function createTimelineTextLayout() {
  const text = new Map<
    string,
    {
      value: string
      font: string
      letterSpacing: number
      whiteSpace: "normal" | "pre-wrap"
      prepared: PreparedText
      width?: number
      lineHeight?: number
      height?: number
    }
  >()

  const rich = new Map<
    string,
    {
      items: RichInlineItem[]
      prepared: PreparedRichInline
      width?: number
      lineHeight?: number
      height?: number
    }
  >()

  let revision = -1

  function refresh(next: number) {
    if (next === revision) return
    revision = next
    clearCache()
    text.clear()
    rich.clear()
  }

  return {
    text(key: string, value: string, width: number, style: TimelineTypography, whiteSpace: "normal" | "pre-wrap") {
      refresh(style.revision)
      const font = `${style.weight} ${style.size}px ${style.family}`
      const targetWidth = Math.max(1, width)
      const previous = text.get(key)

      const sameText =
        previous?.value === value &&
        previous.font === font &&
        previous.letterSpacing === style.letterSpacing &&
        previous.whiteSpace === whiteSpace

      if (
        sameText &&
        previous.width === targetWidth &&
        previous.lineHeight === style.lineHeight &&
        previous.height !== undefined
      )
        return previous.height

      const prepared = sameText
        ? previous.prepared
        : prepare(value, font, { whiteSpace, letterSpacing: style.letterSpacing })

      const height = layout(prepared, targetWidth, style.lineHeight).height
      text.set(key, {
        value,
        font,
        letterSpacing: style.letterSpacing,
        whiteSpace,
        prepared,
        width: targetWidth,
        lineHeight: style.lineHeight,
        height,
      })

      return height
    },
    rich(key: string, items: RichInlineItem[], width: number, lineHeight: number, revision: number) {
      refresh(revision)
      const targetWidth = Math.max(1, width)
      const previous = rich.get(key)
      const same = !!previous && sameItems(previous.items, items)

      if (same && previous.width === targetWidth && previous.lineHeight === lineHeight && previous.height !== undefined)
        return previous.height
      const prepared = same ? previous.prepared : prepareRichInline(items)
      const height = walkRichInlineLineRanges(prepared, targetWidth, () => {}) * lineHeight
      rich.set(key, { items, prepared, width: targetWidth, lineHeight, height })

      return height
    },
    ch(style: TimelineTypography) {
      refresh(style.revision)
      const font = `${style.weight} ${style.size}px ${style.family}`
      const key = `ch:${font}`
      const previous = text.get(key)

      if (previous) return previous.height ?? measureNaturalWidth(previous.prepared)
      const prepared = prepare("0", font)
      const chWidth = measureNaturalWidth(prepared)
      text.set(key, {
        value: "0",
        font,
        letterSpacing: 0,
        whiteSpace: "normal",
        prepared,
        height: chWidth,
      })

      return chWidth
    },
  }
}

// Field by field: the items are rebuilt on every call, and building a string key for each costs more than the walk.
function sameItems(previous: RichInlineItem[], next: RichInlineItem[]) {
  return (
    previous.length === next.length &&
    previous.every(
      (item, index) =>
        item.text === next[index]!.text &&
        item.font === next[index]!.font &&
        item.letterSpacing === next[index]!.letterSpacing &&
        item.break === next[index]!.break &&
        item.extraWidth === next[index]!.extraWidth,
    )
  )
}
