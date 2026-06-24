import { describe, it, expect } from "bun:test"
import { SemanticFingerprintGuard } from "@/muel/semantic-fingerprint"
import { MuelPipeline } from "@/muel/pipeline"

function makePipeline(): MuelPipeline {
  return new MuelPipeline({
    dataProvider: (src) => null,
    ruleocConfig: { rules: [] },
    onAuditEntry: (_entry: unknown) => {},
  })
}

describe("SemanticFingerprintGuard — Context Extraction", () => {
  it("extracts 3 words left and right of term", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    const ctx = g["extractContext"]("Implementasi Sistem keuangan negara stabil", "Implementasi ".length, "Implementasi Sistem".length)
    expect(ctx.has("keuangan")).toBe(true)
    expect(ctx.has("negara")).toBe(true)
    expect(ctx.has("stabil")).toBe(true)
    expect(ctx.has("implementasi")).toBe(true)
    expect(ctx.size).toBeLessThanOrEqual(6)
  })

  it("extracts fewer words when term is near boundary", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    const ctx = g["extractContext"]("Sistem keuangan negara stabil", 0, "Sistem".length)
    expect(ctx.has("keuangan")).toBe(true)
    expect(ctx.has("negara")).toBe(true)
    expect(ctx.has("stabil")).toBe(true)
    expect(ctx.size).toBe(3)
  })

  it("handles term at start with only right context", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Anggaran")
    const ctx = g["extractContext"]("Anggaran pendapatan belanja negara", 0, "Anggaran".length)
    expect(ctx.has("pendapatan")).toBe(true)
    expect(ctx.has("belanja")).toBe(true)
    expect(ctx.has("negara")).toBe(true)
  })
})

describe("SemanticFingerprintGuard — Stopword Filtering", () => {
  it("excludes stopwords from context", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    const ctx = g["extractContext"]("Sistem keuangan dan yang ini itu", 0, "Sistem".length)
    expect(ctx.has("dan")).toBe(false)
    expect(ctx.has("yang")).toBe(false)
    expect(ctx.has("ini")).toBe(false)
    expect(ctx.has("itu")).toBe(false)
    expect(ctx.has("keuangan")).toBe(true)
  })

  it("preserves non-stopword context words", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    const ctx = g["extractContext"]("Sistem keuangan negara stabil", 0, "Sistem".length)
    expect(ctx.has("keuangan")).toBe(true)
    expect(ctx.has("negara")).toBe(true)
    expect(ctx.has("stabil")).toBe(true)
  })
})

describe("SemanticFingerprintGuard — First Occurrence", () => {
  it("saves fingerprint on first occurrence, no collapse", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    const r = g.feed("Sistem keuangan negara stabil. ")
    expect(r.collapse).toBe(false)
    expect(r.term).toBeUndefined()
  })

  it("returns collapse false for first occurrence without trailing period", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    const r = g.feed("Sistem keuangan negara stabil")
    expect(r.collapse).toBe(false)
  })
})

describe("SemanticFingerprintGuard — Stable Context", () => {
  it("no collapse when same context repeats", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.feed("Sistem keuangan negara stabil. ")
    const r = g.feed("Sistem keuangan negara sehat. ")
    expect(r.collapse).toBe(false)
  })

  it("no collapse when context overlaps significantly", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.feed("Implementasi Sistem keuangan negara stabil. ")
    const r = g.feed("Penerapan Sistem keuangan negara transparan. ")
    expect(r.collapse).toBe(false)
  })
})

describe("SemanticFingerprintGuard — Drifted Context", () => {
  it("detects collapse when context completely changes", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.feed("Sistem keuangan negara stabil. ")
    const r = g.feed("Sistem pemerintahan baru dilantik. ")
    expect(r.collapse).toBe(true)
    expect(r.term).toBe("Sistem")
    expect(r.similarity).toBeLessThan(0.2)
  })

  it("detects collapse across multiple occurrences", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Anggaran")
    g.feed("Anggaran pendapatan belanja negara. ")
    g.feed("Realisasi Anggaran kuartal pertama. ")
    const r = g.feed("Anggaran partai politik baru. ")
    expect(r.collapse).toBe(true)
  })
})

describe("SemanticFingerprintGuard — Similarity Boundary", () => {
  it("no collapse when similarity is exactly 0.2", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.feed("Sistem A B C D E. ")
    const r = g.feed("Sistem A B X Y Z. ")
    // Jaccard({a,b,c,d,e} ∩ {a,b,x,y,z}) = 2 / 8 = 0.25 >= 0.2 → no collapse
    expect(r.collapse).toBe(false)
  })
})

describe("SemanticFingerprintGuard — Unknown Term", () => {
  it("returns no collapse for unregistered term", () => {
    const g = new SemanticFingerprintGuard()
    const r = g.feed("Sistem keuangan negara stabil. ")
    expect(r.collapse).toBe(false)
  })
})

describe("SemanticFingerprintGuard — Multiple Terms", () => {
  it("tracks multiple terms independently", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.registerTerm("Anggaran")
    g.feed("Sistem keuangan negara stabil. ")
    g.feed("Anggaran pendapatan belanja negara. ")
    const r1 = g.feed("Sistem pemerintahan baru dilantik. ")
    expect(r1.collapse).toBe(true)
    expect(r1.term).toBe("Sistem")
  })

  it("stable term not affected by drifted term", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.registerTerm("Anggaran")
    g.feed("Sistem keuangan negara stabil. ")
    g.feed("Anggaran pendapatan belanja negara. ")
    g.feed("Sistem pemerintahan baru dilantik. ")
    const r = g.feed("Anggaran pendapatan belanja daerah. ")
    expect(r.collapse).toBe(false)
  })
})

describe("SemanticFingerprintGuard — Reset", () => {
  it("clears all state on reset", () => {
    const g = new SemanticFingerprintGuard()
    g.registerTerm("Sistem")
    g.feed("Sistem keuangan negara stabil. ")
    g.feed("Sistem pemerintahan baru dilantik. ")
    g.reset()
    g.registerTerm("Sistem")
    const r = g.feed("Sistem pemerintahan baru dilantik. ")
    expect(r.collapse).toBe(false)
  })
})

describe("SemanticFingerprintGuard — Pipeline Integration", () => {
  it("returns warn action on semantic collapse", () => {
    const p = makePipeline()
    p.setAnchorDefinition("Sistem", "sistem keuangan negara")
    p.processToken("Sistem keuangan negara stabil. ")
    const r = p.processToken("Sistem pemerintahan baru dilantik. ")
    expect(r.action).toBe("warn")
  })

  it("warn reason contains term name", () => {
    const p = makePipeline()
    p.setAnchorDefinition("Sistem", "sistem keuangan negara")
    p.processToken("Sistem keuangan negara stabil. ")
    const r = p.processToken("Sistem pemerintahan baru dilantik. ")
    expect(r.reason).toContain("Sistem")
    expect(r.reason).toContain("Semantic")
  })

  it("returns pass on stable context through pipeline", () => {
    const p = makePipeline()
    p.setAnchorDefinition("Sistem", "sistem keuangan negara")
    p.processToken("Sistem keuangan negara stabil. ")
    const r = p.processToken("Sistem keuangan daerah kuat. ")
    expect(r.action).toBe("pass")
  })

  it("passes non-anchor text without warning", () => {
    const p = makePipeline()
    const r = p.processToken("Hitung 100 + 200 dan beri jawaban. ")
    expect(r.action).toBe("pass")
  })
})
