import { runtimeUniverSdkWsUrl } from "./runtime-config"

/** Same-origin resolution as spreadsheet relay; empty if unset. */
export function browserUniverSdkWsUrl(): string {
  const v = runtimeUniverSdkWsUrl()?.trim() ?? ""
  if (!v) return ""
  if (v.startsWith("/")) {
    if (typeof window === "undefined") return ""
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${proto}//${window.location.host}${v}`
  }
  return v
}
