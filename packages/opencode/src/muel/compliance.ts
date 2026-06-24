import type { ComplianceState, GateDecision } from "./types"

const SUPERVISED_THRESHOLD = 70
const KILL_THRESHOLD = 30

export class ComplianceTracker {
  private state: ComplianceState = {
    score: 100,
    totalAccepted: 0,
    totalRejected: 0,
    totalFlagged: 0,
    supervised: false,
    killed: false,
  }

  record(decision: GateDecision): void {
    if (this.state.killed) return

    switch (decision) {
      case "ACCEPTED":
        this.state.score = Math.min(100, this.state.score + 1)
        this.state.totalAccepted++
        break
      case "REJECTED":
        this.state.score = Math.max(0, this.state.score - 3)
        this.state.totalRejected++
        break
      case "FLAGGED":
        this.state.score = Math.max(0, this.state.score - 1)
        this.state.totalFlagged++
        break
    }

    if (this.state.score < KILL_THRESHOLD) {
      this.state.killed = true
      this.state.supervised = true
    } else if (this.state.score < SUPERVISED_THRESHOLD) {
      this.state.supervised = true
    } else {
      this.state.supervised = false
    }
  }

  getState(): ComplianceState {
    return { ...this.state }
  }

  isOperational(): boolean {
    return !this.state.killed
  }

  isSupervised(): boolean {
    return this.state.supervised
  }

  kill(): void {
    this.state.score = 0
    this.state.killed = true
    this.state.supervised = true
  }

  reset(): void {
    this.state = { score: 100, totalAccepted: 0, totalRejected: 0, totalFlagged: 0, supervised: false, killed: false }
  }
}
