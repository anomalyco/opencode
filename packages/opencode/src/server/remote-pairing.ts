import { randomBytes } from "crypto"
import { networkInterfaces } from "os"
import { toString as qrToString } from "qrcode"
import { RemoteAccess } from "./remote-access"

export const DEFAULT_REMOTE_TITLE = "Mobile Remote Session"
export const DEFAULT_REMOTE_TTL_SECONDS = 60 * 60 * 12

type PairingInfo = {
  directory: string
  token: string
  expiresAt: number
  sessionID?: string
}

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      if (netInfo.internal || netInfo.family !== "IPv4") continue
      if (!RemoteAccess.allows("lan", netInfo.address) || netInfo.address.startsWith("127.")) continue
      results.push(netInfo.address)
    }
  }

  return [...new Set(results)]
}

export function createServerPassword() {
  return randomBytes(24).toString("base64url")
}

export function buildRemoteURL(base: string, info: PairingInfo) {
  const url = new URL(base)
  const path = url.pathname.replace(/\/$/, "")
  url.pathname = path.endsWith("/remote") ? path || "/remote" : `${path}/remote`.replace(/^$/, "/remote")
  url.search = ""
  url.hash = ""
  url.searchParams.set("token", info.token)
  if (info.sessionID) url.searchParams.set("sessionID", info.sessionID)
  return url.toString()
}

export function buildOrigins(hostname: string, port: number, mdns?: boolean, mdnsDomain?: string) {
  if (hostname === "0.0.0.0") {
    const urls = [`http://localhost:${port}`, ...getNetworkIPs().map((ip) => `http://${ip}:${port}`)]
    if (mdns && mdnsDomain) urls.push(`http://${mdnsDomain}:${port}`)
    return [...new Set(urls)]
  }

  if (hostname === "::" || hostname === "[::]") {
    return [`http://localhost:${port}`]
  }

  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname
  return [`http://${host}:${port}`]
}

export function preferredRemoteURL(urls: string[]) {
  return (
    urls.find((value) => {
      const url = new URL(value)
      return url.hostname !== "localhost" && url.hostname !== "127.0.0.1"
    }) ??
    urls[0] ??
    ""
  )
}

export async function renderQRCodeText(content: string, format: "utf8" | "terminal" = "utf8") {
  if (!content) return ""
  const value =
    format === "terminal"
      ? await qrToString(content, {
          type: "terminal",
          small: true,
          margin: 2,
          errorCorrectionLevel: "L",
        })
      : await qrToString(content, {
          type: "utf8",
          margin: 2,
          errorCorrectionLevel: "L",
        })
  return value.trimEnd()
}
