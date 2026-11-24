/** The longest host a prompt, bar or list names as text; the address bar elides its own from the left instead. */
export const HOST_MAX = 64

/**
 * The host of a URL or origin as the pane names it everywhere, one rule: the canonical ASCII authority (punycode for
 * an international name, the port kept), and when it is longer than `max`, its end, where the registrable domain is,
 * behind a leading "…". Show it in one LTR run, whole and wrapping; never cut it off at the end. Empty for no URL.
 */
export function displayHost(url: string, max = HOST_MAX) {
  if (!URL.canParse(url)) return ""
  const host = new URL(url).host

  return host.length > max ? `…${host.slice(1 - max)}` : host
}

/**
 * The address bar's parts of a web address. It keeps the entire canonical ASCII authority in one LTR run, which the
 * chrome elides from the left, so private or unknown public suffixes, IPv6 literals and ports need no last-two-label
 * heuristic. Undefined for anything but an HTTP(S) address without credentials.
 */
export function hostDisplay(address: string) {
  if (!/^https?:\/\//i.test(address) || !URL.canParse(address)) return
  const url = new URL(address)

  if (url.username || url.password) return

  return {
    scheme: `${url.protocol}//`,
    host: displayHost(address, Infinity),
    rest: `${url.pathname}${url.search}${url.hash}`,
  }
}
