import { fileURLToPath, pathToFileURL } from "bun"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"

const CODE = /`([^`\n]+)`/g
const CONCEALED = /(^|\s)([^\s()]+)\s+\((file:\/\/[^\s)]+)\)/g

export function localLink(input: string, cwd: string) {
  const text = input.replace(CODE, (match, raw: string, index: number, source: string) => {
    if (index > 0 && source[index - 1] === "[" && source.slice(index + match.length).startsWith("](")) return match
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
  if (!raw.includes("/") && !raw.startsWith("./") && !raw.startsWith("../")) return
  return path.resolve(cwd, raw)
}

function pathlike(raw: string) {
  if (!raw) return false
  return (
    raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("~/") || raw.includes("/")
  )
}
