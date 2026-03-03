import { fileURLToPath, pathToFileURL } from "bun"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"

const CODE = /`([^`\n]+)`/g
const CONCEALED = /(^|\s)([^\s()]+)\s+\((file:\/\/[^\s)]+)\)/g

/**
 * Converts local file-like text into markdown links for strict click-to-open behavior.
 *
 * - Rewrites inline code spans such as `foo/bar.csv` to [`foo/bar.csv`](file:///...)
 *   only when the path resolves to an existing local file or directory.
 * - Rewrites concealed output such as `foo/ (file:///abs/foo)` to `[foo/](file:///abs/foo)`
 *   only when the file URL resolves to an existing local target.
 * - Skips code spans that are already inside a markdown link label.
 */
export function localLink(input: string, cwd: string) {
  const text = input.replace(CODE, (match, raw: string, index: number, source: string) => {
    if (inside(source, index, match.length)) return match
    const value = file(raw, cwd)
    if (!value) return match
    return `[\`${raw}\`](${value})`
  })
  return text.replace(CONCEALED, (match, space: string, label: string, href: string) => {
    if (label.startsWith("[") && label.endsWith("]")) return match
    const target = resolve(href, cwd)
    if (!target) return match
    if (!Filesystem.stat(target)) return match
    if (!pathlike(label.trim())) return match
    return `${space}[${label.trim()}](${href})`
  })
}

function inside(source: string, start: number, len: number) {
  const open = source.lastIndexOf("[", start)
  if (open === -1) return false
  if (source.slice(open, start).includes("]")) return false
  const close = source.indexOf("](", start + len)
  if (close === -1) return false
  return true
}

function file(raw: string, cwd: string) {
  const target = resolve(raw.trim(), cwd)
  if (!target) return
  if (!Filesystem.stat(target)) return
  return pathToFileURL(target).href
}

function resolve(raw: string, cwd: string) {
  if (!raw) return
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) return
  if (raw.startsWith("file://")) {
    try {
      return fileURLToPath(raw)
    } catch {
      return
    }
  }
  if (raw.startsWith("~/")) return path.join(Global.Path.home, raw.slice(2))
  if (path.isAbsolute(raw)) return raw
  return path.resolve(cwd, raw)
}

function pathlike(raw: string) {
  if (!raw) return false
  return (
    raw.startsWith("/") ||
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith("~/") ||
    raw.includes("/") ||
    /^[A-Za-z0-9._-]+$/.test(raw)
  )
}
