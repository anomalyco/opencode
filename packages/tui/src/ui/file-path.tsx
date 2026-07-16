import type { RGBA } from "@opentui/core"
import { createMemo } from "solid-js"
import { stringWidth } from "../util/string-width"

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export interface FilePathProps {
  value: string
  maxWidth: number
  fg?: RGBA
  basenameFg?: RGBA
}

export function FilePath(props: FilePathProps) {
  const display = createMemo(() => {
    const value = truncateFilePath(props.value, props.maxWidth)
    const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))
    return {
      parent: value.slice(0, index + 1),
      basename: value.slice(index + 1),
    }
  })
  return (
    <text fg={props.fg} wrapMode="none" truncate>
      <span style={{ fg: props.fg }}>{display().parent}</span>
      <span style={{ fg: props.basenameFg ?? props.fg }}>{display().basename}</span>
    </text>
  )
}

export function truncateFilePath(value: string, maxWidth: number) {
  if (maxWidth <= 0) return ""
  if (stringWidth(value) <= maxWidth) return value

  const drive = value.match(/^([A-Za-z]:)([\\/])/)
  const unc = value.match(/^(\\\\|\/\/)([^\\/]+)[\\/]([^\\/]+)(?:[\\/]|$)/)
  const windows = drive !== null || unc !== null || (!value.includes("/") && value.includes("\\"))
  const separator = drive?.[2] ?? (unc?.[1] === "//" ? "/" : windows ? "\\" : "/")
  const root = drive
    ? drive[1] + separator
    : unc
      ? unc[1] + unc[2] + separator + unc[3] + separator
      : value.startsWith("/")
        ? "/"
        : ""
  const source = value.slice(drive?.[0].length ?? unc?.[0].length ?? root.length)
  const segments = source.split(windows ? /[\\/]/ : separator).filter(Boolean)
  const basename = segments.at(-1) ?? value
  if (segments.length < 2) {
    const rootWidth = stringWidth(root)
    if (rootWidth >= maxWidth) return takeStart(root, maxWidth)
    return root + truncateBasename(basename, maxWidth - rootWidth)
  }

  const prefix = `${root}…${separator}`
  const basenameWidth = maxWidth - stringWidth(prefix)
  if (basenameWidth <= 0) return takeStart(prefix, maxWidth)
  const compact = truncateBasename(basename, basenameWidth)
  if (compact !== basename) return prefix + compact

  const selected = [basename]
  const separatorWidth = stringWidth(separator)
  let width = stringWidth(prefix + basename)
  for (let index = segments.length - 2; index >= 0; index--) {
    const next = stringWidth(segments[index]!) + separatorWidth
    if (width + next > maxWidth) break
    selected.unshift(segments[index]!)
    width += next
  }
  return prefix + selected.join(separator)
}

function truncateBasename(value: string, maxWidth: number) {
  if (stringWidth(value) <= maxWidth) return value
  if (maxWidth <= 1) return takeStart("…", maxWidth)

  const dot = value.lastIndexOf(".")
  const extension = dot > 0 ? value.slice(dot) : ""
  const extensionWidth = stringWidth(extension)
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
    const next = stringWidth(segment)
    if (width + next > maxWidth) break
    selected.push(segment)
    width += next
  }
  if (reverse) selected.reverse()
  return selected.join("")
}
