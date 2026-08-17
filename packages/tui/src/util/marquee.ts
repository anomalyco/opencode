import { Locale } from "./locale"
import { stringWidth } from "./string-width"

const GAP = " · "

export type MarqueeTextPart = {
  value: string
  separator: boolean
}

export function marqueeCycleWidth(value: string) {
  return stringWidth(value + GAP)
}

export function marqueeOverflows(value: string, width: number) {
  return stringWidth(value) > width
}

export function marqueeText(value: string, width: number, offset: number) {
  return marqueeTextParts(value, width, offset)
    .map((part) => part.value)
    .join("")
}

export function marqueeTextParts(value: string, width: number, offset: number): MarqueeTextPart[] {
  if (width <= 0) return []
  if (stringWidth(value) <= width || offset <= 0)
    return Locale.graphemes(Locale.takeWidth(value, width)).map((value) => ({ value, separator: false }))

  const loop = [
    ...Locale.graphemes(value).map((value) => ({ value, separator: false })),
    ...Locale.graphemes(GAP).map((value) => ({ value, separator: value === "·" })),
  ]
  const cursor = offset % marqueeCycleWidth(value)
  const parts = [...loop, ...loop]
  const start = parts.reduce(
    (state, part, index) =>
      state.width >= cursor ? state : { index: index + 1, width: state.width + stringWidth(part.value) },
    { index: 0, width: 0 },
  ).index
  const visible = parts.slice(start).reduce(
    (state, part) => {
      if (state.done) return state
      const next = stringWidth(part.value)
      if (state.width + next > width) return { ...state, done: true }
      return { count: state.count + 1, width: state.width + next, done: false }
    },
    { count: 0, width: 0, done: false },
  ).count
  return parts.slice(start, start + visible)
}
