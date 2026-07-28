export function isTrustedIpcUrl(value: string, devUrl = process.env.ELECTRON_RENDERER_URL) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.protocol === "oc:" && url.host === "renderer") return true
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}
