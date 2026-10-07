import { encodeFilePath } from "@opencode/util/path"
import type { Files } from "../sdk"

/**
 * Turn a link into a path the file model can load: workspace-relative when it is under the root,
 * otherwise absolute. Relative links resolve against `base`; ones that climb past the root
 * become absolute too, so a `../../shared/report.pdf` still opens.
 */
export function resolveLink(files: Files, href: string, base?: string) {
  // Agents cite locations as path:line or path:line:col; the file is what opens.
  const value = href.replaceAll("\\", "/").replace(/:\d+(?::\d+)?$/, "")

  if (/^[a-z]:\//i.test(value) || value.startsWith("/")) return files.resolve(value)
  const relative = resolvePath(base ?? "", value)

  if (relative !== undefined) return files.resolve(relative)
  // Climbing past the workspace root: resolve from the referencing folder's absolute location.
  const root = workspaceRoot(files)
  const dir = base ? `${root}/${base.replace(/\/+$/, "")}` : root

  return files.resolve(resolvePath(dir, value) ?? value)
}

export function isHtml(path: string) {
  const name = path.split(/[\\/]/).pop() ?? ""
  const index = name.lastIndexOf(".")

  if (index <= 0) return false
  const extension = name.slice(index + 1).toLowerCase()

  return extension === "html" || extension === "htm"
}

/** The file:// URL of a workspace-relative path. */
export function workspaceFileURL(files: Files, path: string) {
  return `file://${encodeFilePath(`${workspaceRoot(files)}/${path}`)}`
}

function workspaceRoot(files: Files) {
  return files.root.replaceAll("\\", "/").replace(/\/+$/, "")
}

/**
 * Resolve a relative link against a directory. A relative base yields a workspace-relative path and
 * an absolute base an absolute one; undefined when the link climbs past the base's root.
 */
function resolvePath(base: string, href: string) {
  const target = href.replaceAll("\\", "/")

  if (target.startsWith("/")) return undefined
  const dir = base.replaceAll("\\", "/")
  const segments = [...dir.split("/").filter(Boolean)]

  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue

    if (segment !== "..") {
      segments.push(segment)
      continue
    }

    if (segments.length === 0) return undefined
    segments.pop()
  }

  return `${dir.startsWith("/") ? "/" : ""}${segments.join("/")}`
}
