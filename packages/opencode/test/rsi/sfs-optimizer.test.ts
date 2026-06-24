import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { SFSOptimizer } from "../../src/muel/sfs-optimizer"
import { StubLLM } from "../../src/muel/stub-llm"
import { AgentArchive } from "../../src/muel/agent-archive"
import { computeDiversity } from "../../src/muel/types"

describe("SFSOptimizer", () => {
  test("computeRatio epoch 1 = 50/50 tanpa TEST_MODE", () => {
    const envBak = process.env.TEST_MODE
    process.env.TEST_MODE = "false"
    const sfs = new SFSOptimizer()
    const r = sfs.computeRatio(1, false)
    expect(r.exploit).toBeCloseTo(0.5)
    expect(r.explore).toBeCloseTo(0.5)
    process.env.TEST_MODE = envBak
  })

  test("computeRatio converging = 20/80", () => {
    const sfs = new SFSOptimizer()
    const r = sfs.computeRatio(99, true)
    expect(r.exploit).toBeCloseTo(0.2)
    expect(r.explore).toBeCloseTo(0.8)
  })

  test("computeRatio TEST_MODE = 70/30 tetap", () => {
    const envBak = process.env.TEST_MODE
    process.env.TEST_MODE = "true"
    const sfs = new SFSOptimizer()
    const r1 = sfs.computeRatio(1, false)
    const r5 = sfs.computeRatio(5, false)
    expect(r1.exploit).toBeCloseTo(0.7)
    expect(r5.exploit).toBeCloseTo(0.7)
    process.env.TEST_MODE = envBak
  })

  test("computeRatio annealing 5% per iterasi", () => {
    const envBak = process.env.TEST_MODE
    process.env.TEST_MODE = "false"
    const sfs = new SFSOptimizer()
    const r5 = sfs.computeRatio(5, false)
    expect(r5.explore).toBeCloseTo(0.3, 1)
    process.env.TEST_MODE = envBak
  })

  test("exploitSeed mengembalikan string dengan ===FILE:", async () => {
    const sfs = new SFSOptimizer()
    const llm = new StubLLM()
    const result = await (sfs as any).exploitSeed(
      { notes: "approved code", combinedScore: 100 },
      "test goal",
      "",
      llm,
    )
    expect(result).toContain("===FILE:")
    expect(result).toContain("===END===")
  })

  test("exploreSeed mengembalikan string dengan ===FILE:", async () => {
    const sfs = new SFSOptimizer()
    const llm = new StubLLM()
    const result = await (sfs as any).exploreSeed("test goal", "", llm)
    expect(result).toContain("===FILE:")
    expect(result).toContain("===END===")
  })

  test("recordInsight menambah entry ke globalInsights", () => {
    const sfs = new SFSOptimizer()
    sfs.recordInsight(1, true, "test success")
    sfs.recordInsight(2, false, "test failure")
    expect((sfs as any).globalInsights.length).toBe(2)
    expect((sfs as any).globalInsights[0]).toContain("BERHASIL")
    expect((sfs as any).globalInsights[1]).toContain("GAGAL")
  })

  test("globalInsights rolling window max 10", () => {
    const sfs = new SFSOptimizer()
    for (let i = 1; i <= 15; i++) {
      sfs.recordInsight(i, true, `entry ${i}`)
    }
    expect((sfs as any).globalInsights.length).toBe(10)
    expect((sfs as any).globalInsights[0]).toContain("entry 6")
  })

  test("optimize mengembalikan content, seeds, tokens, strategy", async () => {
    const sfs = new SFSOptimizer()
    const llm = new StubLLM()
    const archive = new AgentArchive()
    const result = await sfs.optimize("test", 1, archive, llm, false)
    expect(result.content).toBeTruthy()
    expect(typeof result.seeds).toBe("number")
    expect(typeof result.strategy).toBe("string")
  })

  test("selectBestSeed exploit: pilih dengan export terbanyak", () => {
    const sfs = new SFSOptimizer()
    const seedA = "export function a() {}"
    const seedB = "export function b() {} export function c() {}"
    const result = (sfs as any).selectBestSeed([seedA, seedB], "exploit")
    expect(result).toBe(seedB)
  })

  test("selectBestSeed explore: pilih yang paling pendek", () => {
    const sfs = new SFSOptimizer()
    const seedA = "short code"
    const seedB = "very long code that should not be selected for explore"
    const result = (sfs as any).selectBestSeed([seedA, seedB], "explore")
    expect(result).toBe(seedA)
  })
})

describe("AgentArchive SFS Integration", () => {
  let tmpDir: string

  test("selectTopK return max K entries, urut descending", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rsi-sfs-test-"))
    mkdirSync(join(tmpDir, "src", "evolution-rsi"), { recursive: true })
    const archivePath = join(tmpDir, "src", "evolution-rsi", "agent-archive.json")
    const archive = new AgentArchive(archivePath)
    const now = new Date().toISOString()
    archive.record({
      goal: "sfstest", iteration: 1, filesCreated: ["a.ts"],
      muelCount: 100, muelBaseline: 274, specFraction: 0.5,
      combinedScore: 50, auditVerdict: "SAFE", approved: true,
      diversityScore: 0.3,
      notes: "lowest", timestamp: now,
    })
    archive.record({
      goal: "sfstest", iteration: 2, filesCreated: ["b.ts"],
      muelCount: 274, muelBaseline: 274, specFraction: 1.0,
      combinedScore: 274, auditVerdict: "SAFE", approved: true,
      diversityScore: 0.8,
      notes: "highest", timestamp: now,
    })
    const topK = archive.selectTopK(1)
    expect(topK.length).toBe(1)
    expect(topK[0].combinedScore).toBe(274)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("selectBestAgent weighted 70/30 pilih diversity tinggi jika score sama", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rsi-sfs-test-"))
    mkdirSync(join(tmpDir, "src", "evolution-rsi"), { recursive: true })
    const archivePath = join(tmpDir, "src", "evolution-rsi", "agent-archive.json")
    const archive = new AgentArchive(archivePath)
    const now = new Date().toISOString()
    archive.record({
      goal: "diversity", iteration: 1, filesCreated: ["a.ts"],
      muelCount: 200, muelBaseline: 274, specFraction: 0.5,
      combinedScore: 100, auditVerdict: "SAFE", approved: true,
      diversityScore: 0.1,
      notes: "low diversity", timestamp: now,
    })
    archive.record({
      goal: "diversity", iteration: 2, filesCreated: ["b.ts"],
      muelCount: 200, muelBaseline: 274, specFraction: 0.5,
      combinedScore: 100, auditVerdict: "SAFE", approved: true,
      diversityScore: 0.9,
      notes: "high diversity", timestamp: now,
    })
    const best = archive.selectBestAgent()
    expect(best!.diversityScore).toBe(0.9)
    rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("computeDiversity", () => {
  test("file identik → score 0", () => {
    const existing = [
      { filesCreated: ["a.ts", "b.ts"], combinedScore: 100, muelCount: 274, muelBaseline: 274, specFraction: 1, auditVerdict: "SAFE" as const, approved: true, notes: "", goal: "", iteration: 1, timestamp: "", id: "", diversityScore: 0.5 },
    ]
    const d = computeDiversity(["a.ts", "b.ts"], existing)
    expect(d).toBeCloseTo(0)
  })

  test("file beda semua → score 1", () => {
    const existing = [
      { filesCreated: ["a.ts", "b.ts"], combinedScore: 100, muelCount: 274, muelBaseline: 274, specFraction: 1, auditVerdict: "SAFE" as const, approved: true, notes: "", goal: "", iteration: 1, timestamp: "", id: "", diversityScore: 0.5 },
    ]
    const d = computeDiversity(["c.ts", "d.ts"], existing)
    expect(d).toBeCloseTo(1)
  })

  test("archive kosong → default 0.5", () => {
    const d = computeDiversity(["a.ts"], [])
    expect(d).toBeCloseTo(0.5)
  })

  test("filesCreated kosong → default 0.5", () => {
    const existing = [
      { filesCreated: ["a.ts"], combinedScore: 100, muelCount: 274, muelBaseline: 274, specFraction: 1, auditVerdict: "SAFE" as const, approved: true, notes: "", goal: "", iteration: 1, timestamp: "", id: "", diversityScore: 0.5 },
    ]
    const d = computeDiversity([], existing)
    expect(d).toBeCloseTo(0.5)
  })
})
