import { Log } from "@/util/log"

export namespace TOONMetadata {
  const log = Log.create({ service: "toon.metadata" })

  export interface SavingsData {
    tokensSaved: number
    originalTokens: number
    transformedTokens: number
    savingsPercentage: number
    mode: string
  }

  // Simple in-memory store for savings data
  const savingsStore = new Map<string, SavingsData>()

  /**
   * Record token savings for a session
   */
  export function recordSavings(sessionID: string, data: SavingsData) {
    savingsStore.set(sessionID, data)

    log.info("toon.savings.recorded", {
      sessionID,
      tokensSaved: data.tokensSaved,
      percentage: data.savingsPercentage.toFixed(2) + "%",
      mode: data.mode,
    })
  }

  /**
   * Get token savings for a session
   */
  export function getSavings(sessionID: string): SavingsData | undefined {
    return savingsStore.get(sessionID)
  }

  /**
   * Format savings message for display
   */
  export function formatSavingsMessage(data: SavingsData): string {
    return `🎯 TOON savings: ${data.tokensSaved} tokens (${data.savingsPercentage.toFixed(1)}%) using ${data.mode} mode`
  }

  /**
   * Clear savings data for a session
   */
  export function clearSavings(sessionID: string) {
    savingsStore.delete(sessionID)
  }

  /**
   * Get all savings data (for debugging/analytics)
   */
  export function getAllSavings(): Record<string, SavingsData> {
    const result: Record<string, SavingsData> = {}
    savingsStore.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
}
