const rendererProtocol = "oc:"
const rendererHost = "renderer"

export function isTrustedNavigationUrl(value: string, devUrl = process.env.ELECTRON_RENDERER_URL) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol === rendererProtocol && url.host === rendererHost) return true
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}
