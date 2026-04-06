import { Installation } from "@/installation"
import { z } from "zod"

const API_VERSION = "2025-04-01"

function normalize(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function base(url?: string) {
  if (!url) return "https://api.github.com"
  return `https://api.${normalize(url)}`
}

const quota = z
  .object({
    entitlement: z.number().optional(),
    overage_count: z.number().optional(),
    overage_permitted: z.boolean().optional(),
    percent_remaining: z.number().optional(),
    quota_id: z.string().optional(),
    quota_remaining: z.number().optional(),
    remaining: z.number().optional(),
    unlimited: z.boolean().optional(),
  })
  .passthrough()

const usage = z
  .object({
    copilot_plan: z.string().optional(),
    quota_reset_date: z.string().optional(),
    quota_snapshots: z
      .object({
        premium_interactions: quota.optional(),
        chat: quota.optional(),
        completions: quota.optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough()

type Usage = z.infer<typeof usage>
type Quota = z.infer<typeof quota>

export class UsageError extends Error {
  constructor(
    readonly code: "not_logged_in" | "token_invalid" | "forbidden" | "not_found" | "bad_response" | "request_failed",
    readonly status?: number,
  ) {
    super(code)
  }
}

export namespace CopilotUsage {
  export async function get(input: { token?: string; enterpriseUrl?: string }) {
    if (!input.token) throw new UsageError("not_logged_in")

    const res = await fetch(`${base(input.enterpriseUrl)}/copilot_internal/user`, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `token ${input.token}`,
        "User-Agent": `opencode/${Installation.VERSION}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (res.status === 401) throw new UsageError("token_invalid", res.status)
    if (res.status === 403) throw new UsageError("forbidden", res.status)
    if (res.status === 404) throw new UsageError("not_found", res.status)
    if (!res.ok) throw new UsageError("request_failed", res.status)

    const json = await res.json()
    const parsed = usage.safeParse(json)
    if (!parsed.success) throw new UsageError("bad_response", res.status)
    return parsed.data
  }

  export function format(input: { usage: Usage; raw?: boolean }) {
    const data = input.usage
    const sum = brief({ usage: data })
    const out = [
      `使用额度: ${sum.used}`,
      `剩余额度: ${sum.remaining}`,
      `总额度: ${sum.total}`,
      `刷新时间: ${sum.reset}`,
    ]

    if (!input.raw) return out.join("\n")
    return `${out.join("\n")}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
  }

  export function explain(err: unknown) {
    if (!(err instanceof UsageError)) return "请求 Copilot usage 失败。请稍后重试。"
    if (err.code === "not_logged_in") return "未检测到 GitHub Copilot 登录。请先在 OpenCode 中连接 GitHub Copilot。"
    if (err.code === "token_invalid") return "GitHub token 已失效或已过期。请重新登录 GitHub Copilot。"
    if (err.code === "forbidden") return "当前账号没有访问 Copilot usage 的权限，或未开通 Copilot/Premium。"
    if (err.code === "not_found") return "未找到 Copilot usage 接口，可能是账号/企业环境不支持该端点。"
    if (err.code === "bad_response") return "GitHub 返回了无法识别的 usage 数据格式。"
    return `GitHub 接口请求失败（HTTP ${err.status ?? "unknown"}）。`
  }

  export function brief(input: { usage: Usage }) {
    const item = pick(input.usage)
    return {
      used: use(item),
      remaining: left(item),
      total: cap(item),
      percent: pct(item),
      reset: input.usage.quota_reset_date ?? "-",
    }
  }
}

function val(v?: number) {
  return typeof v === "number" ? v.toString() : "-"
}

function pick(data: Usage) {
  const list = [
    data.quota_snapshots?.premium_interactions,
    data.quota_snapshots?.chat,
    data.quota_snapshots?.completions,
  ].filter((x): x is Quota => Boolean(x))
  if (!list.length) return undefined
  const finite = list.find((x) => x.unlimited !== true && (x.entitlement ?? 0) > 0)
  if (finite) return finite
  return list[0]
}

function left(item?: Quota) {
  if (!item) return "-"
  if (item.unlimited === true) return "无限"
  const v = typeof item.remaining === "number" ? item.remaining : item.quota_remaining
  return val(v)
}

function cap(item?: Quota) {
  if (!item) return "-"
  if (item.unlimited === true) return "无限"
  return val(item.entitlement)
}

function use(item?: Quota) {
  if (!item) return "-"
  if (item.unlimited === true) return "-"
  if (typeof item.entitlement !== "number") return "-"
  const r = typeof item.remaining === "number" ? item.remaining : item.quota_remaining
  if (typeof r !== "number") return "-"
  return String(Math.max(item.entitlement - r, 0))
}

function pct(item?: Quota) {
  if (!item) return undefined
  if (item.unlimited === true) return undefined
  if (typeof item.percent_remaining === "number") {
    return Math.max(0, Math.min(100, 100 - item.percent_remaining))
  }
  if (typeof item.entitlement !== "number") return undefined
  const r = typeof item.remaining === "number" ? item.remaining : item.quota_remaining
  if (typeof r !== "number") return undefined
  const used = Math.max(item.entitlement - r, 0)
  return Math.max(0, Math.min(100, (used / item.entitlement) * 100))
}
