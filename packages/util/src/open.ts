import open from "open"
import path from "node:path"
import { fileURLToPath } from "node:url"

export function openUrl(input: string) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
    return Promise.reject(new Error(`Only http and https links can be opened in the browser: ${input}`))
  return open(url.href)
}

export function openPath(target: string) {
  return open(target)
}

/** Open an http(s) URL in the browser, or a local file path / file:// link with the OS handler. */
export function openHref(input: string, base?: string) {
  const target = resolveOpenTarget(input, base)
  if (!target) return Promise.reject(new Error(`Only http, https, and local file links can be opened: ${input}`))
  return open(target)
}

/** @internal */
export function resolveOpenTarget(input: string, base?: string) {
  // Href spelling is URI-like: decode percent-escapes and drop #fragment / ?query so
  // plan%20notes.md#section → plan notes.md while literal % / # use %25 / %23.
  const decoded = decodeHrefPath(input)
  // Remote shares are not local files. "//server/share" and "\\server\share" (including mixed
  // separator pairs) reach SMB/UNC paths on Windows, so reject them before any absolute-path
  // shortcut and again after decoding, where %2F%5C... style spellings would otherwise slip through.
  if (isRemotePath(decoded)) return undefined
  // Absolute paths before URL parsing: URL.canParse treats "C:\..." / "C:/..." as scheme "c:".
  if (path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)) return decoded
  if (URL.canParse(input)) {
    const url = new URL(input)
    if (url.protocol === "http:" || url.protocol === "https:") return url.href
    // Match desktop: only local file URLs (no host) become filesystem paths.
    if (url.protocol === "file:" && !url.hostname) {
      try {
        const target = fileURLToPath(url.href)
        return isRemotePath(target) ? undefined : target
      } catch {
        return undefined
      }
    }
    return undefined
  }
  // Resolve project-relative Markdown links such as plan/example.md against the session directory.
  if (base === undefined || input.length === 0 || input.startsWith("#")) return
  const target = path.resolve(base, decoded)
  return isRemotePath(target) ? undefined : target
}

/** Paths that reach a remote SMB share or a Windows device namespace instead of a local file. */
function isRemotePath(value: string) {
  // Windows treats either slash as a separator, so mixed pairs like "/\server" and "\/server"
  // are UNC roots too. A single leading "\" is only drive-rooted, not remote.
  return /^[\\/]{2}/.test(value)
}

function decodeHrefPath(input: string) {
  const hash = input.indexOf("#")
  const query = input.indexOf("?")
  const end = Math.min(...[hash, query].filter((index) => index !== -1), input.length)
  const pathPart = input.slice(0, end)
  try {
    return decodeURIComponent(pathPart)
  } catch {
    return pathPart
  }
}
