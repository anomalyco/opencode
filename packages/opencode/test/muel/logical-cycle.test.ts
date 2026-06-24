import { describe, it, expect } from "bun:test"
import { LogicalCycleDetector } from "@/muel/logical-cycle"
import { MuelPipeline } from "@/muel/pipeline"

function makePipeline(): MuelPipeline {
  return new MuelPipeline({
    dataProvider: (src) => null,
    ruleocConfig: { rules: [] },
    onAuditEntry: (_entry: unknown) => {},
  })
}

describe("LogicalCycleDetector — parseCausalEdge", () => {
  it("detects 'X karena Y' pattern", () => {
    const lc = new LogicalCycleDetector()
    const edge = lc["parseCausalEdge"]("Sistem ini aman karena tidak ada kesalahan berarti")
    expect(edge).not.toBeNull()
    expect(edge!.cause).toContain("tidak ada kesalahan")
    expect(edge!.effect).toContain("sistem ini aman")
  })

  it("detects 'X sehingga Y' pattern", () => {
    const lc = new LogicalCycleDetector()
    const edge = lc["parseCausalEdge"]("Anggaran negara naik sehingga defisit tahun turun")
    expect(edge).not.toBeNull()
    expect(edge!.cause).toContain("defisit tahun turun")
    expect(edge!.effect).toContain("anggaran negara naik")
  })

  it("detects 'X oleh karena itu Y' pattern", () => {
    const lc = new LogicalCycleDetector()
    const edge = lc["parseCausalEdge"]("Pajak penghasilan meningkat oleh karena itu pendapatan negara naik")
    expect(edge).not.toBeNull()
  })

  it("detects 'akibatnya' pattern", () => {
    const lc = new LogicalCycleDetector()
    const edge = lc["parseCausalEdge"]("Terjadi kesalahan besar akibatnya sistem komputer crash total")
    expect(edge).not.toBeNull()
  })

  it("returns null for sentence without causal connector", () => {
    const lc = new LogicalCycleDetector()
    const edge = lc["parseCausalEdge"]("Hitung 2+3 dan beri jawaban")
    expect(edge).toBeNull()
  })

  it("returns null if cause/effect has <3 words (no false positive)", () => {
    const lc = new LogicalCycleDetector()
    const edge = lc["parseCausalEdge"]("A karena B")
    expect(edge).toBeNull()
  })
})

describe("LogicalCycleDetector — Cycle Detection", () => {
  it("detects 2-node cycle: A→B, B→A", () => {
    const lc = new LogicalCycleDetector()
    lc["addEdge"]("sistem aman tidak ada", "tidak ada kesalahan sistem")
    lc["addEdge"]("tidak ada kesalahan sistem", "sistem aman tidak ada")
    const result = lc["detectCycle"]()
    expect(result.cycle).toBe(true)
    expect(result.path.length).toBeGreaterThanOrEqual(2)
  })

  it("detects 3-node cycle: A→B, B→C, C→A", () => {
    const lc = new LogicalCycleDetector()
    lc["addEdge"]("anggaran naik defisit", "defisit turun pendapatan")
    lc["addEdge"]("defisit turun pendapatan", "pajak meningkat ekonomi")
    lc["addEdge"]("pajak meningkat ekonomi", "anggaran naik defisit")
    const result = lc["detectCycle"]()
    expect(result.cycle).toBe(true)
  })

  it("returns no cycle for linear dependencies", () => {
    const lc = new LogicalCycleDetector()
    lc["addEdge"]("sistem aman tidak ada", "tidak ada kesalahan sistem")
    lc["addEdge"]("tidak ada kesalahan sistem", "kesalahan sudah diperbaiki")
    lc["addEdge"]("kesalahan sudah diperbaiki", "sistem sudah diverifikasi")
    const result = lc["detectCycle"]()
    expect(result.cycle).toBe(false)
  })

  it("returns no cycle for disconnected claims", () => {
    const lc = new LogicalCycleDetector()
    lc["addEdge"]("anggaran naik defisit", "defisit turun pendapatan")
    const result = lc["detectCycle"]()
    expect(result.cycle).toBe(false)
  })

  it("detects cycle after second feed", () => {
    const lc = new LogicalCycleDetector()
    const r1 = lc.feed("Sistem ini sangat aman karena tidak ada kesalahan berarti. ")
    expect(r1.cycle).toBe(false)

    const r2 = lc.feed("Tidak ada kesalahan berarti karena sistem ini sangat aman.")
    expect(r2.cycle).toBe(true)
    expect(r2.path.length).toBeGreaterThanOrEqual(2)
  })
})

describe("LogicalCycleDetector — Streaming Feed", () => {
  it("detects cycle across chunk boundaries", () => {
    const lc = new LogicalCycleDetector()
    const r1 = lc.feed("Sistem ini sangat aman karena ")
    expect(r1.cycle).toBe(false)

    const r2 = lc.feed("tidak ada kesalahan berarti")
    expect(r2.cycle).toBe(false)

    const r3 = lc.feed(" Tidak ada kesalahan berarti karena sistem ini sangat aman.")
    expect(r3.cycle).toBe(true)
  })

  it("handles incomplete sentence at buffer end", () => {
    const lc = new LogicalCycleDetector()
    const r = lc.feed("Sistem ini aman karena belum")
    expect(r.cycle).toBe(false)
  })

  it("processes multiple sentences in one chunk", () => {
    const lc = new LogicalCycleDetector()
    const r = lc.feed("Anggaran negara naik karena defisit tahun turun. Defisit tahun turun karena anggaran negara naik.")
    expect(r.cycle).toBe(true)
  })
})

describe("LogicalCycleDetector — Reset", () => {
  it("clears all state on reset", () => {
    const lc = new LogicalCycleDetector()
    lc.feed("Sistem ini sangat aman karena tidak ada kesalahan berarti")
    lc.feed("Tidak ada kesalahan berarti karena sistem ini sangat aman")
    lc.reset()
    const r = lc.feed("Sistem ini sangat aman karena tidak ada kesalahan berarti")
    expect(r.cycle).toBe(false)
  })
})

describe("LogicalCycleDetector — Pipeline Integration", () => {
  it("blocks token with logical cycle via pipeline", () => {
    const p = makePipeline()
    const result1 = p.processToken("Sistem ini sangat aman karena tidak ada kesalahan berarti. ")
    expect(result1.action).toBe("pass")

    const result2 = p.processToken("Tidak ada kesalahan berarti karena sistem ini sangat aman.")
    expect(result2.action).toBe("block")
    expect(result2.reason).toContain("MUEL")
  })

  it("passes normal text (no cycle)", () => {
    const p = makePipeline()
    const r = p.processToken("Anggaran APBN 2024 naik 5 persen. ")
    expect(r.action).toBe("pass")
  })

  it("block reason contains SIKLUS", () => {
    const p = makePipeline()
    p.processToken("Sistem ini sangat aman karena tidak ada kesalahan berarti. ")
    const r = p.processToken("Tidak ada kesalahan berarti karena sistem ini sangat aman.")
    expect(r.reason).toContain("SIKLUS")
  })

  it("passes non-causal text", () => {
    const p = makePipeline()
    const r = p.processToken("Hitung 100 + 200 dan beri jawaban. ")
    expect(r.action).toBe("pass")
  })
})
