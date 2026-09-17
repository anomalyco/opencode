// MUC Harness: Sub2API 网关常量与凭据驱动的动态模型发现。
//
// 安全规则（硬性约束）：
// - 本文件与整个仓库禁止出现任何真实 API Key（CI 有 sk- 模式扫描）。
// - 真实凭据由 MUC Desktop 通过 muc://connect 换取后存入系统凭据管理器
//   （macOS Keychain，经 Electron safeStorage 加密），并以内存环境变量
//   MUC_API_KEY 注入 opencode 核心 —— 不落盘、不进配置文件。
// - Gateway Base URL 是可配置常量：默认 HTTPS，可用 MUC_GATEWAY_URL 覆盖
//   （开发期兼容 HTTP，正式发布走 HTTPS）。

export const MUC = {
  id: "sub2api",
  host: "admin.wuxuexi.top",
  npm: "@ai-sdk/openai-compatible",
  name: "Sub2API",
}

const DEFAULT_GATEWAY = "https://admin.wuxuexi.top"

// Gateway 根地址（不带 /v1）。默认 HTTPS；仅允许环境变量覆盖。
export function mucGatewayBaseURL(): string {
  const raw = process.env.MUC_GATEWAY_URL?.trim() || DEFAULT_GATEWAY
  return raw.replace(/\/+$/, "")
}

export function mucGatewayV1(): string {
  return mucGatewayBaseURL() + "/v1"
}

// 凭据只来自内存环境变量（MUC Desktop 注入）；不存在则视为未连接。
export function mucApiKey(): string | undefined {
  const key = process.env.MUC_API_KEY?.trim()
  return key && key.length > 0 ? key : undefined
}

// 用户配置里已有同名 provider 时不注入，返回 null。
// 仅当存在 MUC 凭据时才注入默认 provider（保证未连接状态下不出现在模型列表）。
export function sub2apiDefaultProvider(existing?: Record<string, unknown>, apiKey?: string) {
  if (existing && existing[MUC.id]) return null
  if (!apiKey) return null
  return {
    npm: MUC.npm,
    name: MUC.name,
    options: {
      baseURL: mucGatewayV1(),
      apiKey,
      dynamicModels: true,
    },
  }
}

// 拉取网关 /v1/models，失败时返回空数组（回退到静态配置模型）。
export async function fetchSub2APIModels(baseURL: string, apiKey?: string): Promise<string[]> {
  try {
    const url = baseURL.replace(/\/+$/, "") + "/models"
    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as any
    const items = Array.isArray(data?.data) ? data.data : []
    return items.map((m: any) => String(m?.id)).filter(Boolean)
  } catch {
    return []
  }
}
