// quota-fetch.ts — quota.tsx 的纯逻辑分支：读取 auth.json、解析 GitHub Copilot 配额响应。
// 抽离动机：与 Solid/opentui 渲染解耦，便于在 Bun test 中直接覆盖（避免拉入原生 opentui binding）。
import path from "node:path"
import { readFile } from "node:fs/promises"

export interface QuotaAuth {
  quotaUrl: string
  /** GitHub OAuth refresh token，用 "token <gho>" 头格式访问 GitHub API */
  token: string
}

export interface QuotaInfo {
  /** 已用百分比（0-100） */
  remaining: number
  /** 总配额，固定 100 表示百分比模式 */
  entitlement: number
}

export async function readQuotaAuth(stateDir: string): Promise<QuotaAuth | null> {
  try {
    const text = await readFile(path.join(stateDir, "auth.json"), "utf-8")
    const data = JSON.parse(text) as Record<string, unknown>

    // github-copilot 直连模式：用 OAuth refresh token 访问 /copilot_internal/user
    const copilotEntry = data["github-copilot"] as Record<string, unknown> | undefined
    if (copilotEntry?.type !== "oauth") return null

    const refresh = copilotEntry.refresh as string | undefined
    if (!refresh) return null

    const enterpriseUrl = copilotEntry.enterpriseUrl as string | undefined
    const apiBase = enterpriseUrl
      ? `https://api.${enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
      : "https://api.github.com"
    return {
      quotaUrl: `${apiBase}/copilot_internal/user`,
      token: refresh,
    }
  } catch {
    return null
  }
}

/** 从 GitHub Copilot API 响应解析 premium request 配额（百分比模式） */
export function parseCopilotQuota(data: Record<string, unknown>): QuotaInfo | null {
  const snapshots = data.quotaSnapshots as Record<string, unknown> | undefined
  const premium = snapshots?.premiumInteractions as Record<string, unknown> | undefined
  if (!premium) return null

  const percentRemaining = typeof premium.percentRemaining === "number" ? premium.percentRemaining : null
  if (percentRemaining === null) return null

  return {
    remaining: 100 - percentRemaining,
    entitlement: 100,
  }
}

export async function fetchQuota(auth: QuotaAuth): Promise<QuotaInfo | null> {
  try {
    const resp = await fetch(auth.quotaUrl, {
      headers: { Authorization: `token ${auth.token}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!resp.ok) return null
    return parseCopilotQuota((await resp.json()) as Record<string, unknown>)
  } catch {
    return null
  }
}
