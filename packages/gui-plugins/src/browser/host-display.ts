/** Keep the entire canonical ASCII authority in one LTR run. The chrome elides this run from the left, so
 * private/unknown public suffixes, IPv6 literals and port numbers need no last-two-label heuristic. */
export function hostDisplay(address: string) {
  if (!/^https?:\/\//i.test(address) || !URL.canParse(address)) return
  const url = new URL(address)

  if (url.username || url.password) return

  return { scheme: `${url.protocol}//`, host: url.host, rest: `${url.pathname}${url.search}${url.hash}` }
}
