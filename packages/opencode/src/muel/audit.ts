import crypto from "crypto"
import type { AuditEntry, GateDecision } from "./types"

export class AuditChain {
  private entries: AuditEntry[] = []
  private lastHash = "0000000000000000000000000000000000000000000000000000000000000000"

  append(decision: GateDecision, sessionID: string, claim: string, evidenceSource: string, confidence: number, reason?: string): AuditEntry {
    const timestamp = Date.now()
    const payload = JSON.stringify({ decision, sessionID, claim, evidenceSource, confidence, reason, prevHash: this.lastHash, timestamp })
    const hash = crypto.createHash("sha256").update(payload).digest("hex")

    const entry: AuditEntry = {
      hash,
      prevHash: this.lastHash,
      timestamp,
      decision,
      sessionID,
      claim: claim.slice(0, 200),
      evidenceSource,
      confidence,
      reason,
    }

    this.entries.push(entry)
    this.lastHash = hash
    return entry
  }

  getChain(): readonly AuditEntry[] {
    return this.entries
  }

  verifyChain(): boolean {
    let prevHash = "0000000000000000000000000000000000000000000000000000000000000000"
    for (const entry of this.entries) {
      const payload = JSON.stringify({ decision: entry.decision, sessionID: entry.sessionID, claim: entry.claim, evidenceSource: entry.evidenceSource, confidence: entry.confidence, reason: entry.reason, prevHash, timestamp: entry.timestamp })
      const hash = crypto.createHash("sha256").update(payload).digest("hex")
      if (hash !== entry.hash) return false
      if (entry.prevHash !== prevHash) return false
      prevHash = entry.hash
    }
    return true
  }

  clear(): void {
    this.entries = []
    this.lastHash = "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
