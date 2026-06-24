import { readFileSync, writeFileSync, existsSync } from "fs"
import type { AgentVersion } from "./types"

export class AgentArchive {
  private versions: AgentVersion[] = []
  private readonly archivePath: string

  constructor(archivePath = "src/evolution-rsi/agent-archive.json") {
    this.archivePath = archivePath
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.archivePath)) {
        this.versions = JSON.parse(readFileSync(this.archivePath, "utf8"))
      }
    } catch {
      this.versions = []
    }
  }

  record(version: Omit<AgentVersion, "id" | "diversityScore"> & { diversityScore?: number }): AgentVersion {
    const existing = this.versions.filter(v => v.goal === version.goal)
    const diversityScore = version.diversityScore ?? 0.5
    const entry: AgentVersion = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...version,
      diversityScore,
    }
    this.versions.push(entry)
    writeFileSync(this.archivePath, JSON.stringify(this.versions, null, 2))
    return entry
  }

  selectBestAgent(): AgentVersion | null {
    const approved = this.versions.filter(v => v.approved)
    if (approved.length === 0) return null
    return approved.reduce((best, v) => {
      const bestScore = 0.7 * best.combinedScore + 0.3 * (best.diversityScore ?? 0.5)
      const vScore = 0.7 * v.combinedScore + 0.3 * (v.diversityScore ?? 0.5)
      return vScore > bestScore ? v : best
    })
  }

  selectTopK(k: number): { notes: string; combinedScore: number }[] {
    const approved = [...this.versions].filter(v => v.approved)
    approved.sort((a, b) => b.combinedScore - a.combinedScore)
    return approved.slice(0, k).map(v => ({
      notes: v.notes,
      combinedScore: v.combinedScore,
    }))
  }

  getSummary(goalId: string): string {
    const goalVersions = this.versions.filter(v => v.goal.includes(goalId))
    if (goalVersions.length === 0) return "Tidak ada riwayat untuk goal ini."

    const best = goalVersions.reduce((a, b) =>
      a.combinedScore > b.combinedScore ? a : b,
    )
    const approved = goalVersions.filter(v => v.approved).length
    const total = goalVersions.length

    return [
      `  Total iterasi: ${total}`,
      `  Disetujui: ${approved}`,
      `  Skor terbaik: ${best.combinedScore.toFixed(3)} (MUEL: ${best.muelCount}/${best.muelBaseline}, Spec: ${(best.specFraction * 100).toFixed(0)}%)`,
      `  Timestamp terbaik: ${best.timestamp}`,
    ].join("\n")
  }

  getAllVersions(): AgentVersion[] {
    return [...this.versions]
  }
}
