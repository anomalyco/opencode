// MUC Harness: 一次性授权码交换客户端。
// 只与用户自己的网关通信；请求体不含任何管理员凭据。
// 服务器返回的是该用户（per-device）自己的 API Key。

export type MucExchangeResult = {
  gateway: string
  apiKey: string
  keyName: string
  user: string
}

export class MucExchangeError extends Error {
  constructor(
    public reason: "invalid" | "expired" | "used" | "network" | "bad_response",
    message: string,
  ) {
    super(message)
  }
}

export async function exchangeMucCode(gateway: string, code: string, deviceName: string): Promise<MucExchangeResult> {
  const url = gateway.replace(/\/+$/, "") + "/api/v1/muc/exchange"
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, device_name: deviceName }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new MucExchangeError("network", "cannot reach authorization server")
  }

  const body = (await res.json().catch(() => null)) as any

  if (res.status === 404 || body?.error === "code_not_found") {
    throw new MucExchangeError("invalid", "authorization code not found")
  }
  if (res.status === 410 || body?.error === "code_expired") {
    throw new MucExchangeError("expired", "authorization code expired, please reconnect from the website")
  }
  if (res.status === 409 || body?.error === "code_used") {
    throw new MucExchangeError("used", "authorization code already used, please request a new one")
  }
  if (res.status === 401 || res.status === 403) {
    throw new MucExchangeError("invalid", "authorization rejected by server")
  }
  if (!res.ok || !body?.api_key || !body?.gateway) {
    throw new MucExchangeError("bad_response", "unexpected response from authorization server")
  }

  return {
    gateway: String(body.gateway).replace(/\/+$/, ""),
    apiKey: String(body.api_key),
    keyName: String(body.key_name ?? "MUC"),
    user: String(body.user ?? ""),
  }
}

// 连接成功后立即同步 /v1/models，向用户反馈可用模型数量（失败不阻塞连接）
export async function countGatewayModels(gateway: string, apiKey: string): Promise<number | undefined> {
  try {
    const res = await fetch(gateway.replace(/\/+$/, "") + "/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as any
    const items = Array.isArray(data?.data) ? data.data : []
    return items.length
  } catch {
    return undefined
  }
}
