// URL policy, from packages/gui-extensions/src/browser/policy.ts without file:// support: a real
// browser profile must not be pointed at local files by an agent.

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

/** Pages an extension may debug and share: ordinary web pages. */
export function shareable(url: string | undefined) {
  if (!url || !destinationOrigin(url)) return false
  const host = new URL(url).hostname
  return host !== "chromewebstore.google.com" && host !== "chrome.google.com"
}
