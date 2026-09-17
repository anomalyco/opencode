// MUC Harness: muc:// 深链解析。
// 仅接受 muc://connect?code=<one-time-code>；code 为服务端签发的一次性授权码，
// 绝不允许出现 API Key（含 key/api_key 参数一律拒绝）。

export type MucConnectLink = {
  kind: "connect"
  code: string
}

const CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function parseMucUrl(raw: string): MucConnectLink | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== "muc:") return null
    // muc://connect?code=... → URL 解析 host 为 "connect"
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
