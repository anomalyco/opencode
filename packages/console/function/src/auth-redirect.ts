export const isAllowedAuthorizationRedirect = (clientID: string, redirectURI: string) => {
  if (clientID !== "app") return false
  const redirect = (() => {
    try {
      return new URL(redirectURI)
    } catch {
      return undefined
    }
  })()
  if (redirect === undefined) return false
  if (redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1") {
    return redirect.protocol === "http:" || redirect.protocol === "https:"
  }
  return (
    redirect.protocol === "https:" &&
    (redirect.hostname === "opencode.ai" || redirect.hostname.endsWith(".opencode.ai"))
  )
}
