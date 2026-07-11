import type { RGBA } from "@opentui/core"

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export interface FilePathProps {
  value: string
  maxWidth: number
  fg?: RGBA
}

export function FilePath(props: FilePathProps) {
  return (
    <text fg={props.fg} wrapMode="none" truncate>
      {truncateFilePath(props.value, props.maxWidth)}
    </text>
  )
}

export function truncateFilePath(value: string, maxWidth: number) {
  if (maxWidth <= 0) return ""
  if (Bun.stringWidth(value) <= maxWidth) return value

  const separator = value.includes("/") ? "/" : "\\"
  const drive = separator === "\\" ? value.match(/^[A-Za-z]:\\/)?.[0] : undefined
  const root = drive ?? (value.startsWith(separator) ? separator : "")
  const segments = value.slice(root.length).split(separator).filter(Boolean)
  const basename = segments.at(-1) ?? value
  if (segments.length < 2) {
    const rootWidth = Bun.stringWidth(root)
    if (rootWidth >= maxWidth) return takeStart(root, maxWidth)
    return root + truncateBasename(basename, maxWidth - rootWidth)
  }

  const prefix = `…${separator}`
  const basenameWidth = maxWidth - Bun.stringWidth(prefix)
  if (basenameWidth <= 0) return takeStart("…", maxWidth)
  const compact = truncateBasename(basename, basenameWidth)
  if (compact !== basename) return prefix + compact

  const selected = [basename]
  const separatorWidth = Bun.stringWidth(separator)
  let width = Bun.stringWidth(prefix + basename)
  for (let index = segments.length - 2; index >= 0; index--) {
    const next = Bun.stringWidth(segments[index]!) + separatorWidth
    if (width + next > maxWidth) break
    selected.unshift(segments[index]!)
    width += next
  }
  return prefix + selected.join(separator)
}

function truncateBasename(value: string, maxWidth: number) {
  if (Bun.stringWidth(value) <= maxWidth) return value
  if (maxWidth <= 1) return takeStart("…", maxWidth)

  const dot = value.lastIndexOf(".")
  const extension = dot > 0 ? value.slice(dot) : ""
  const extensionWidth = Bun.stringWidth(extension)
  if (extensionWidth >= maxWidth) return "…" + takeEnd(extension, maxWidth - 1)

  const stem = extension ? value.slice(0, dot) : value
  return takeStart(stem, maxWidth - extensionWidth - 1) + "…" + extension
}

function takeStart(value: string, maxWidth: number) {
  return take(value, maxWidth, false)
}

function takeEnd(value: string, maxWidth: number) {
  return take(value, maxWidth, true)
}

function take(value: string, maxWidth: number, reverse: boolean) {
  const segments = Array.from(graphemeSegmenter.segment(value), (item) => item.segment)
  if (reverse) segments.reverse()
  const selected: string[] = []
  let width = 0
  for (const segment of segments) {
    const next = Bun.stringWidth(segment)
    if (width + next > maxWidth) break
    selected.push(segment)
    width += next
  }
  if (reverse) selected.reverse()
  return selected.join("")
}
