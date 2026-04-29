import z from "zod"

export const ConsoleQuotaWindow = z.object({
  remainingPercent: z.number().min(0).max(100),
  resetSeconds: z.number().int().nonnegative().optional(),
  resetAt: z.number().int().nonnegative().optional(),
})

export const ProviderQuotaConfidence = z.enum(["exact", "reported", "estimated"])

export const ProviderQuotaSource = z.enum(["official_api", "response_headers", "client_state", "heuristic"])

export const ProviderQuotaWindow = z.object({
  label: z.string(),
  remainingPercent: z.number().min(0).max(100).optional(),
  remaining: z.number().nonnegative().int().optional(),
  limit: z.number().nonnegative().int().optional(),
  resetAt: z.number().int().nonnegative().optional(),
  confidence: ProviderQuotaConfidence,
  source: ProviderQuotaSource,
})

export const ProviderQuotaSnapshot = z.object({
  provider: z.string(),
  label: z.string(),
  fetchedAt: z.number().int().nonnegative(),
  status: z.enum(["available", "unavailable", "degraded"]),
  windows: z.array(ProviderQuotaWindow),
  detail: z.string().optional(),
})

export const ProviderQuotaResponse = z.object({
  providerQuota: z.array(ProviderQuotaSnapshot),
  fetchedAt: z.number().int().nonnegative(),
})
export type ProviderQuotaResponse = z.infer<typeof ProviderQuotaResponse>

export const CodexQuotaSnapshot = z.object({
  fiveHour: ConsoleQuotaWindow.optional(),
  weekly: ConsoleQuotaWindow.optional(),
  fetchedAt: z.number().int().nonnegative().optional(),
})

export const ConsoleState = z.object({
  consoleManagedProviders: z.array(z.string()),
  activeOrgName: z.string().optional(),
  switchableOrgCount: z.number().int().nonnegative(),
  providerQuota: z.array(ProviderQuotaSnapshot).optional(),
  codexQuota: CodexQuotaSnapshot.optional(),
})

export type ConsoleState = z.infer<typeof ConsoleState>

export const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  activeOrgName: undefined,
  switchableOrgCount: 0,
  providerQuota: undefined,
  codexQuota: undefined,
}
