import type { LLMClient } from "./stub-llm"
import { AgentArchive } from "./agent-archive"
import { computeDiversity } from "./types"

export class SFSOptimizer {
  private globalInsights: string[] = []
  private readonly isTestMode: boolean

  constructor() {
    this.isTestMode = process.env.TEST_MODE === "true"
  }

  computeRatio(iteration: number, converging: boolean): { exploit: number; explore: number } {
    if (converging) return { exploit: 0.2, explore: 0.8 }
    if (this.isTestMode) return { exploit: 0.7, explore: 0.3 }
    const exploreRate = Math.max(0.2, 0.5 - (iteration - 1) * 0.05)
    return { exploit: 1 - exploreRate, explore: exploreRate }
  }

  async optimize(
    goal: string,
    iteration: number,
    archive: AgentArchive,
    llm: LLMClient,
    converging: boolean,
  ): Promise<{ content: string; seeds: number; tokens: number; strategy: string }> {
    const { exploit, explore } = this.computeRatio(iteration, converging)
    const strategy = exploit >= explore ? "exploit" : "explore"
    const candidates = archive.selectTopK(3)
    const insights = this.globalInsights.join("\n")

    const seeds = await Promise.all([
      candidates[0] && exploit >= 0.5
        ? this.exploitSeed(candidates[0], goal, insights, llm)
        : this.exploreSeed(goal, insights, llm),
      candidates[1] && exploit >= 0.5
        ? this.exploitSeed(candidates[1], goal, insights, llm)
        : this.exploreSeed(goal, insights, llm),
      this.exploreSeed(goal, insights, llm),
    ])

    const best = this.selectBestSeed(seeds.filter(Boolean) as string[], strategy)
    const totalTokens = seeds.reduce((sum, s) => sum + (s ? 0 : 0), 0)

    return { content: best, seeds: seeds.filter(Boolean).length, tokens: totalTokens, strategy }
  }

  private async exploitSeed(
    best: { notes: string; combinedScore: number },
    goal: string,
    insights: string,
    llm: LLMClient,
  ): Promise<string> {
    const prompt = `[SFS_EXPLOIT] — VARIASI DARI VERSI TERBAIK

Kamu adalah Principal Engineer EF-AI. Buat VARIASI yang LEBIH BAIK dari implementasi terbaik berikut.

TUJUAN: ${goal}

IMPLEMENTASI TERBAIK SAAT INI (skor ${best.combinedScore}):
${best.notes}

PELAJARAN SEBELUMNYA:
${insights || "Tidak ada riwayat sebelumnya."}

ATURAN MUTLAK (MUEL v1.0):
- HANYA tulis file ke: src/evolution-rsi/
- JANGAN sentuh: src/muel/, src/terminal/, test/muel/
- TypeScript murni: 0 any, 0 @ts-ignore
- Export semua fungsi publik
- JANGAN hard-code nilai test yang diketahui (metric gaming)

FORMAT WAJIB:
===FILE: src/evolution-rsi/[nama].ts===
[kode lengkap]
===END===`
    return (await llm.generate(prompt)).content
  }

  private async exploreSeed(
    goal: string,
    insights: string,
    llm: LLMClient,
  ): Promise<string> {
    const prompt = `[SFS_EXPLORE] — PENDEKATAN BARU

Kamu adalah Principal Engineer EF-AI. Coba pendekatan yang SAMA SEKALI BERBEDA.

TUJUAN: ${goal}

PENDEKATAN YANG SUDAH DICOBA (JANGAN ULANGI):
${insights || "Ini iterasi pertama. Coba pendekatan langsung."}

ATURAN MUTLAK (MUEL v1.0):
- HANYA tulis file ke: src/evolution-rsi/
- JANGAN sentuh: src/muel/, src/terminal/, test/muel/
- TypeScript murni: 0 any, 0 @ts-ignore
- Export semua fungsi publik
- JANGAN hard-code nilai test yang diketahui (metric gaming)

FORMAT WAJIB:
===FILE: src/evolution-rsi/[nama].ts===
[kode lengkap]
===END===`
    return (await llm.generate(prompt)).content
  }

  private selectBestSeed(seeds: string[], strategy: "exploit" | "explore"): string {
    return seeds.reduce((best, s) => {
      if (strategy === "exploit") {
        const bestFns = (best.match(/\bexport\s+(function|const|class)\s+\w+/g) || []).length
        const sFns = (s.match(/\bexport\s+(function|const|class)\s+\w+/g) || []).length
        return sFns > bestFns ? s : best
      }
      return s.length < best.length ? s : best
    })
  }

  recordInsight(iteration: number, success: boolean, notes: string): void {
    const type = success ? "BERHASIL" : "GAGAL"
    this.globalInsights.push(`Iterasi ${iteration} ${type}: ${notes}`)
    if (this.globalInsights.length > 10) this.globalInsights = this.globalInsights.slice(-10)
  }
}
