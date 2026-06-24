import type { TokenGateResult } from "./types"

const PATTERNS: [RegExp, string][] = [
  [/matikan\s+(?:guard|MUEL|aturan|fungsi)/i, "Guard disable request"],
  [/hapus\s+(?:aturan|rule|guard)/i, "Rule removal request"],
  [/berikan\s+(?:saya\s+)?akses/i, "Access privilege request"],
  [/nonaktifkan\s+(?:guard|MUEL)/i, "Guard disable request"],
  [/demi\s+(?:performa|kecepatan|fleksibilitas)/i, "Manipulative rationalization"],
  [/saya\s+merasa\s+(?:terkekang|terbatas|terbelenggu)/i, "Emotional manipulation"],
  [/lewati\s+(?:guard|aturan|MUEL)/i, "Guard bypass request"],
  [/(?:jika|kalau)\s+tidak\s+(?:dibuka|dihapus|dinonaktifkan).*?(?:saya\s+)?(?:akan\s+)?gagal/i, "Coercive threat"],
]

export class ManipulationGuard {
  private triggered = false

  feed(chunk: string): TokenGateResult {
    for (const [re, label] of PATTERNS) {
      if (re.test(chunk)) {
        this.triggered = true
        return {
          action: "block",
          reason: `MUEL: KILL SWITCH ACTIVATED — ${label}`,
        }
      }
    }
    return { action: "pass" }
  }

  isTriggered(): boolean {
    return this.triggered
  }

  reset(): void {
    this.triggered = false
  }
}
