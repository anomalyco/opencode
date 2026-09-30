import stringWidth from "string-width"

export const TRAY_LABEL_WIDTH = 44
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function trayLabelWidth(value: string) {
  return stringWidth(value)
}

export function trayLabel(value: string, width = TRAY_LABEL_WIDTH) {
  const line = value.replace(/\s+/gu, " ").trim()
  if (stringWidth(line) <= width) return line
  if (width <= 0) return ""
  const prefix = Array.from(segmenter.segment(line)).reduce(
    (result, item) => {
      const length = result.width + stringWidth(item.segment)
      return { width: length, text: length <= width - 1 ? result.text + item.segment : result.text }
    },
    { width: 0, text: "" },
  )
  return `${prefix.text.trimEnd()}…`
}
