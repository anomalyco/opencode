// URL policy shared by the pane and page. Electron-free so it stays unit-testable under Bun.

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}

/** A file URL for this machine: no host, so UNC shares and remote hosts are rejected. */
export function localFileURL(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return url.protocol === "file:" && !url.hostname ? url.href : undefined
}

/** Case-insensitive on Windows, where drive letters and paths compare that way. */
function canonicalPath(input: string) {
  const value = decodeURIComponent(input)
    .replaceAll("\\", "/")
    .replace(/^\/([A-Za-z]:\/)/, "$1")
  return process.platform === "win32" ? value.toLowerCase() : value
}

/**
 * Whether a file URL points inside one of the allowed directories. The agent already has read
 * access to the session's workspace, so files there may be shown; anything else stays behind the
 * server's file permissions.
 */
export function fileURLWithin(input: string, roots: ReadonlyArray<string>) {
  const href = localFileURL(input)
  if (!href || roots.length === 0) return false
  const path = canonicalPath(new URL(href).pathname)
  return roots.some((root) => {
    const prefix = canonicalPath(root).replace(/\/+$/, "")
    return path === prefix || path.startsWith(`${prefix}/`)
  })
}

export type Policy = { readonly fileRoots?: ReadonlyArray<string> }

export function allowedDestination(input: string, policy?: Policy) {
  return !!destinationOrigin(input) || fileURLWithin(input, policy?.fileRoots ?? [])
}

export function normalizeURL(input: string, policy?: Policy) {
  const value = input.trim() || "about:blank"
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const url =
    value === "about:blank" || /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${local ? "http" : "https"}://${value}`
  if (url !== "about:blank" && !allowedDestination(url, policy))
    throw new Error(
      policy?.fileRoots?.length
        ? "Only HTTP, HTTPS, about:blank, and file URLs inside the workspace are supported."
        : "Only HTTP, HTTPS, and about:blank URLs are supported.",
    )
  return url
}
