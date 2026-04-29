import type { ProviderQuotaResponse } from "../config/console-state"
import type { Auth } from "../auth"
import { getCodexQuotaSnapshot } from "../plugin/codex"

export interface CodexQuotaInput {
  getAuth: () => Promise<Auth.Info | undefined>
  setAuth: (auth: Auth.Info) => Promise<void>
  fetchImpl?: typeof fetch
}

type CodexQuotaSnapshot = NonNullable<Awaited<ReturnType<typeof getCodexQuotaSnapshot>>>
type ProviderQuotaWindow = ProviderQuotaResponse["providerQuota"][number]["windows"][number]

function exact(
  label: string,
  window: { remainingPercent?: number; resetAt?: number } | undefined,
): ProviderQuotaWindow | undefined {
  if (window?.remainingPercent === undefined) return
  return {
    label,
    remainingPercent: window.remainingPercent,
    ...(window.resetAt !== undefined ? { resetAt: window.resetAt } : {}),
    confidence: "exact",
    source: "official_api",
  }
}

function codex(now: number, quota: CodexQuotaSnapshot | undefined) {
  if (!quota) return
  const windows = [exact("5h", quota.fiveHour), exact("wk", quota.weekly)].filter(
    (window): window is ProviderQuotaWindow => Boolean(window),
  )
  if (windows.length === 0) return

  return {
    provider: "codex",
    label: "codex",
    fetchedAt: now,
    status: "available" as const,
    windows,
  }
}

export async function getProviderQuotaSnapshots(input: CodexQuotaInput): Promise<ProviderQuotaResponse> {
  const now = Date.now()
  const codexQuota = await getCodexQuotaSnapshot(input).catch(() => undefined)
  const list = [codex(now, codexQuota)].flatMap((value) => (value ? [value] : []))
  return {
    providerQuota: list,
    fetchedAt: now,
  }
}
