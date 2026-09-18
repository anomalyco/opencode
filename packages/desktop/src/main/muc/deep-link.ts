// 校园 Harness（MUC / HUBU 共用）：<scheme>:// 深链解析。
// 仅接受 <scheme>://connect?code=<one-time-code>；code 为服务端签发的一次性授权码，
// 绝不允许出现 API Key（含 key/api_key 参数一律拒绝）。

import { resolveBrand } from "@opencode-ai/brand"

export type MucConnectLink = {
  kind: "connect"
  code: string
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

// scheme 默认取当前品牌（BRAND / OPENCODE_CHANNEL），也可显式指定
export function parseCampusUrl(raw: string, scheme = resolveBrand().protocolScheme): MucConnectLink | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== `${scheme}:`) return null
    // <scheme>://connect?code=... → URL 解析 host 为 "connect"
    const host = (url.hostname || url.host || "").toLowerCase()
    if (host !== "connect") return null
    if (url.searchParams.has("key") || url.searchParams.has("api_key")) return null
    const code = url.searchParams.get("code")?.trim()
    if (!code || !CODE_PATTERN.test(code)) return null
    return { kind: "connect", code }
  } catch {
    return null
  }
}

// 历史兼容：muc:// 专用解析
export function parseMucUrl(raw: string): MucConnectLink | null {
  return parseCampusUrl(raw, "muc")
}
