/** A web address written in a session, never a relative file, fragment, or UNC path. Desktop renderer origins
 * need not be HTTP, so use the session server's web scheme for a network-path reference. */
export function webHref(written: string, server: string) {
  const value = written.trim()

  if (!/^(?:https?:\/\/|\/\/)(?![\/\\])/i.test(value) || !URL.canParse(value, server)) return
  const url = new URL(value, server)

  return /^https?:$/.test(url.protocol) ? url.href : undefined
}
