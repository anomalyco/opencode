export interface RateWindow {
  label: string
  usedPercent: number
  windowMinutes?: number
  resetsAt?: string
}

export interface ProviderUsage {
  providerId: string
  providerLabel: string
  status: "ok" | "error" | "unsupported" | "unlimited"
  primary?: RateWindow
  secondary?: RateWindow
  tertiary?: RateWindow
  error?: string
  plan?: string
  accountEmail?: string
}

export interface UsageSnapshot {
  providers: ProviderUsage[]
  fetchedAt: string
}
