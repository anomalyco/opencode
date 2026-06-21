const trimSlash = (url: string) => url.replace(/\/+$/, "")

const legacyAppHosts = new Set(["app.opencode.ai", "app.dev.opencode.ai"])

function hostedStageDomain(hostname: string) {
  if (!hostname.startsWith("app.")) return null
  if (legacyAppHosts.has(hostname)) return null
  return hostname.slice("app.".length)
}

/** OpenCode server base URL for the web app SDK (voice control plane). */
export function hostedOpencodeServerUrl() {
  const explicit = import.meta.env.VITE_OPENCODE_SERVER_URL
  if (explicit) return trimSlash(explicit)

  if (import.meta.env.DEV) {
    const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"
    const port = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"
    return `http://${host}:${port}`
  }

  if (typeof location === "undefined") return "http://localhost:4096"

  const stageDomain = hostedStageDomain(location.hostname)
  if (stageDomain) return `https://server.${stageDomain}`

  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"

  return location.origin
}

/** Voice sidecar base URL (STT/TTS media plane). */
export function hostedVoiceSidecarUrl() {
  const explicit = import.meta.env.VITE_VOICE_SIDECAR_URL
  if (explicit) return trimSlash(explicit)

  if (typeof location === "undefined") return "http://127.0.0.1:8765"

  const stageDomain = hostedStageDomain(location.hostname)
  if (stageDomain) return `https://voice.${stageDomain}`

  return "http://127.0.0.1:8765"
}
