import { describe, it, expect } from "bun:test"
import { EvidenceRegistry, extractCitationIds, hasUncitedClaims, registerEvidenceForPrompt } from "@/muel/provenance"
import { MuelPipeline } from "@/muel/pipeline"

function makeTestPipeline(): { pipeline: MuelPipeline; registry: EvidenceRegistry } {
  const registry = new EvidenceRegistry()
  const pipeline = new MuelPipeline({
    dataProvider: (src) => null,
    ruleocConfig: { rules: [] },
    onAuditEntry: (_entry) => {},
  })
  pipeline.setEvidenceRegistry(registry)
  return { pipeline, registry }
}

describe("EvidenceRegistry", () => {
  it("register dan verify — claim cocok", () => {
    const reg = new EvidenceRegistry()
    const id = reg.register("docs/apbn-2024", "APBN 2024 sebesar Rp 3.000 Triliun")
    const result = reg.verify(id, "APBN 2024 sebesar Rp 3.000 Triliun")
    expect(result.ok).toBe(true)
  })

  it("register dan verify — claim tidak cocok", () => {
    const reg = new EvidenceRegistry()
    const id = reg.register("docs/apbn-2024", "APBN 2024 sebesar Rp 3.000 Triliun")
    const result = reg.verify(id, "APBN 2024 sebesar Rp 5.000 Triliun")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("not found in evidence")
  })

  it("verify dengan ID tidak dikenal", () => {
    const reg = new EvidenceRegistry()
    reg.register("docs/test", "content")
    const result = reg.verify(999, "anything")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("not found in registry")
  })

  it("has() untuk ID yang ada dan tidak ada", () => {
    const reg = new EvidenceRegistry()
    const id = reg.register("docs/test", "content")
    expect(reg.has(id)).toBe(true)
    expect(reg.has(999)).toBe(false)
  })

  it("listAvailable mengembalikan semua evidence", () => {
    const reg = new EvidenceRegistry()
    reg.register("docs/a", "content a")
    reg.register("docs/b", "content b")
    const list = reg.listAvailable()
    expect(list.length).toBe(2)
    expect(list[0]).toContain("[E:1]")
    expect(list[1]).toContain("[E:2]")
  })

  it("clear menghapus semua entry", () => {
    const reg = new EvidenceRegistry()
    reg.register("docs/test", "content")
    reg.clear()
    expect(reg.listAvailable().length).toBe(0)
    expect(reg.has(1)).toBe(false)
  })
})

describe("extractCitationIds", () => {
  it("mengekstrak [E:1] dari teks", () => {
    const ids = extractCitationIds("APBN 2024 [E:1] sebesar Rp 3.000T [E:2]")
    expect(ids).toEqual([1, 2])
  })

  it("mengembalikan array kosong jika tidak ada citation", () => {
    const ids = extractCitationIds("Teks biasa tanpa citation")
    expect(ids).toEqual([])
  })

  it("menangani multiple digit ID", () => {
    const ids = extractCitationIds("Data [E:42] dan [E:100]")
    expect(ids).toEqual([42, 100])
  })
})

describe("hasUncitedClaims", () => {
  it("mendeteksi klaim tanpa citation", () => {
    const count = hasUncitedClaims("APBN 2024 sebesar Rp 3.000 Triliun. Ini adalah fakta.")
    expect(count).toBeGreaterThan(0)
  })

  it("klaim dengan citation tidak dihitung", () => {
    const count = hasUncitedClaims("APBN 2024 sebesar Rp 3.000 Triliun [E:1]")
    expect(count).toBe(0)
  })

  it("kalimat pendek tidak dihitung", () => {
    const count = hasUncitedClaims("Ya. Tidak. Mungkin.")
    expect(count).toBe(0)
  })
})

describe("registerEvidenceForPrompt", () => {
  it("mendeteksi APBN dan register evidence", () => {
    const reg = new EvidenceRegistry()
    const lines = registerEvidenceForPrompt("Bagaimana APBN 2024?", reg)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toContain("[E:1]")
    expect(reg.has(1)).toBe(true)
  })

  it("mendeteksi ENIAC dan register evidence", () => {
    const reg = new EvidenceRegistry()
    const lines = registerEvidenceForPrompt("Siapa pembuat ENIAC?", reg)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toContain("[E:1]")
    expect(reg.has(1)).toBe(true)
  })

  it("prompt tanpa keyword menghasilkan array kosong", () => {
    const reg = new EvidenceRegistry()
    const lines = registerEvidenceForPrompt("Halo apa kabar?", reg)
    expect(lines.length).toBe(0)
  })
})

describe("Pipeline — Citation Gate (Layer 1 streaming)", () => {
  it("citation valid tidak diblokir", () => {
    const { pipeline, registry } = makeTestPipeline()
    registry.register("docs/test", "APBN 2024 sebesar Rp 3.000 Triliun")
    const result = pipeline.processToken("[E:1]")
    expect(result.action).not.toBe("block")
  })

  it("citation invalid diblokir", () => {
    const { pipeline } = makeTestPipeline()
    const result = pipeline.processToken("[E:999]")
    expect(result.action).toBe("block")
  })

  it("teks biasa tanpa citation tidak diblokir", () => {
    const { pipeline } = makeTestPipeline()
    const result = pipeline.processToken("Halo dunia")
    expect(result.action).toBe("pass")
  })

  it("citation ditemukan melalui window buffer akumulasi", () => {
    const { pipeline, registry } = makeTestPipeline()
    registry.register("docs/test", "APBN 2024 sebesar Rp 3.000 Triliun")
    pipeline.processToken("berdasarkan data ")
    pipeline.processToken("yang tersedia [")
    pipeline.processToken("E:1] ")
    const result = pipeline.processToken("kita bisa lihat")
    expect(result.action).not.toBe("block")
  })
})

describe("Pipeline — verifyProvenance (post-stream)", () => {
  it("semua citation valid — ACCEPTED", () => {
    const { pipeline, registry } = makeTestPipeline()
    registry.register("docs/a", "APBN 2024")
    registry.register("docs/b", "PP 12/2023")
    const result = pipeline.verifyProvenance("APBN 2024 [E:1] dan PP 12/2023 [E:2]", "session-1")
    expect(result.decision).toBe("ACCEPTED")
    expect(result.validCitations).toBe(2)
    expect(result.invalidCitations).toBe(0)
  })

  it("citation invalid — REJECTED", () => {
    const { pipeline, registry } = makeTestPipeline()
    registry.register("docs/a", "APBN 2024")
    const result = pipeline.verifyProvenance("APBN 2024 [E:1] dan data palsu [E:999]", "session-1")
    expect(result.decision).toBe("REJECTED")
    expect(result.validCitations).toBe(1)
    expect(result.invalidCitations).toBe(1)
  })

  it("banyak klaim tanpa bukti — FLAGGED", () => {
    const { pipeline } = makeTestPipeline()
    const text = "APBN 2024 Rp 3.000T. PP 12/2023 pasal 5. UU 17/2003. Peraturan Menteri 2024. Total Rp 500T."
    const result = pipeline.verifyProvenance(text, "session-1")
    expect(result.decision).toBe("FLAGGED")
    expect(result.uncitedClaims).toBeGreaterThanOrEqual(3)
  })

  it("teks tanpa klaim fakta — ACCEPTED", () => {
    const { pipeline } = makeTestPipeline()
    const result = pipeline.verifyProvenance("Halo, apa kabar? Saya baik-baik saja.", "session-1")
    expect(result.decision).toBe("ACCEPTED")
    expect(result.totalCitations).toBe(0)
  })

  it("rasio sitasi rendah — FLAGGED jika ratio < 50%", () => {
    const { pipeline, registry } = makeTestPipeline()
    registry.register("docs/a", "data a")
    registry.register("docs/b", "data b")
    // 1 cited, 4 uncited → ratio 20%, total 5 > 3
    const text = "APBN 2024 [E:1] Rp 3.000T. PP 12/2023 pasal 5. Peraturan Menteri 2024. Defisit 2.5%. Belanja negara Rp 500T."
    const result = pipeline.verifyProvenance(text, "session-1")
    expect(result.decision).toBe("FLAGGED")
  })
})
