// URL policy shared by the pane and page. Electron-free so it stays unit-testable under Bun.

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)
  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}

export function normalizeURL(input: string) {
  const value = input.trim() || "about:blank"
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)
  const url =
    value === "about:blank" || /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${local ? "http" : "https"}://${value}`
  if (url !== "about:blank" && !destinationOrigin(url))
    throw new Error("Only HTTP, HTTPS, and about:blank URLs are supported.")
  return url
}
