import { Locale } from "./locale"
import { stringWidth } from "./string-width"

const GAP = " · "

export function marqueeCycleWidth(value: string) {
  return stringWidth(value + GAP)
}

export function marqueeText(value: string, width: number, offset: number) {
  if (width <= 0) return ""
  if (stringWidth(value) <= width || offset <= 0) return Locale.takeWidth(value, width)

  const loop = value + GAP
  const cursor = offset % marqueeCycleWidth(value)
  const segments = Locale.graphemes(loop + loop)
  const start = segments.reduce(
    (state, segment, index) =>
      state.width >= cursor ? state : { index: index + 1, width: state.width + stringWidth(segment) },
    { index: 0, width: 0 },
  ).index
  return Locale.takeWidth(segments.slice(start).join(""), width)
}
