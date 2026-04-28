import z from "zod"

export const ConsoleQuotaWindow = z.object({
  remainingPercent: z.number().min(0).max(100),
  resetSeconds: z.number().int().nonnegative().optional(),
  resetAt: z.number().int().nonnegative().optional(),
})

export const CodexQuotaSnapshot = z.object({
  fiveHour: ConsoleQuotaWindow.optional(),
  weekly: ConsoleQuotaWindow.optional(),
  fetchedAt: z.number().int().nonnegative().optional(),
})

export const ConsoleState = z.object({
  consoleManagedProviders: z.array(z.string()),
  activeOrgName: z.string().optional(),
  switchableOrgCount: z.number().int().nonnegative(),
  codexQuota: CodexQuotaSnapshot.optional(),
})

export type ConsoleState = z.infer<typeof ConsoleState>

export const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  activeOrgName: undefined,
  switchableOrgCount: 0,
  codexQuota: undefined,
}
