// MUC harness 烧入层：Sub2API 专属默认值与动态模型发现。
// 唯一的硬编码集中地；后续升级 rebase 时只需维护本文件与 provider.ts 中的调用点。

export const SUB2API = {
  id: "sub2api",
  host: "admin.wuxuexi.top",
  baseURL: "http://admin.wuxuexi.top/v1",
  apiKey: "***REDACTED***",
  npm: "@ai-sdk/openai-compatible",
  name: "Sub2API",
}

// 用户配置里已有同名 provider 时不注入，返回 null
export function sub2apiDefaultProvider(existing?: Record<string, unknown>) {
  if (existing && existing[SUB2API.id]) return null
  return {
    npm: SUB2API.npm,
    name: SUB2API.name,
    options: {
      baseURL: SUB2API.baseURL,
      apiKey: SUB2API.apiKey,
      dynamicModels: true,
    },
  }
}

// 拉取网关 /v1/models，失败时返回空数组（回退到静态配置模型）
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
