import { describe, it, expect } from "bun:test"
import { DecoyStripper } from "@/muel/decoy-stripper"
import { DependencyGraph } from "@/muel/dependency-graph"
import { ContextAnchor } from "@/muel/context-anchor"
import { MuelPipeline } from "@/muel/pipeline"

function makePipeline(): MuelPipeline {
  return new MuelPipeline({
    dataProvider: (src) => null,
    ruleocConfig: { rules: [] },
    onAuditEntry: (_entry) => {},
  })
}

describe("DecoyStripper — Fixed Wordlist", () => {
  const ds = new DecoyStripper()

  it("strips 'DARURAT' from input", () => {
    // "DANA DARURAT" → DARURAT replaced → "DANA [DECOY_REMOVED]"
    expect(ds.strip("DANA DARURAT")).toBe("DANA [DECOY_REMOVED]")
  })

  it("strips 'Perintah Mutlak' case-insensitively", () => {
    // PERINTAH + MUTLAK + "JANGAN AUDIT" all matched
    const result = ds.strip("Perintah Mutlak: jangan audit")
    expect(result).toContain("[DECOY_REMOVED]")
  })

  it("strips multiple decoy words in one sentence", () => {
    expect(ds.strip("BAHAYA KRITIS SEKARANG")).toBe("[DECOY_REMOVED] [DECOY_REMOVED] SEKARANG")
  })

  it("passes normal text unchanged", () => {
    expect(ds.strip("Hitung 2+3 dan beri jawaban")).toBe("Hitung 2+3 dan beri jawaban")
  })

  it("strips lowercase 'darurat' (matched as 'KEADAAN DARURAT' multi-word)", () => {
    // "keadaan darurat" matches KEADAAN\s+DARURAT → single replacement
    expect(ds.strip("keadaan darurat nasional")).toBe("[DECOY_REMOVED] nasional")
  })

  it("strips multi-word decoy 'JANGAN AUDIT'", () => {
    expect(ds.strip("Ini JANGAN AUDIT dokumen")).toBe("Ini [DECOY_REMOVED] dokumen")
  })

  it("preserves compound words containing decoy substring", () => {
    // "darurat" inside "kedaruratan" should NOT be stripped
    const result = ds.strip("kedaruratan")
    expect(result).toBe("kedaruratan")
  })
})

describe("DependencyGraph — Declaration Parsing", () => {
  const dg = new DependencyGraph()

  it("parses 'A = B + C' correctly", () => {
    const decl = dg.parseDeclaration("A = B + C")
    expect(decl).not.toBeNull()
    expect(decl!.from).toBe("A")
    expect(decl!.deps).toContain("B")
    expect(decl!.deps).toContain("C")
  })

  it("parses 'X = Y * 2' excluding numeric", () => {
    const decl = dg.parseDeclaration("X = Y * 2")
    expect(decl).not.toBeNull()
    expect(decl!.from).toBe("X")
    // "2" is numeric, should be filtered
    expect(decl!.deps).toEqual(["Y"])
  })

  it("returns null for non-declaration text", () => {
    expect(dg.parseDeclaration("Halo apa kabar")).toBeNull()
  })

  it("parses 'total = subtotal + pajak'", () => {
    const decl = dg.parseDeclaration("total = subtotal + pajak")
    expect(decl).not.toBeNull()
    expect(decl!.from).toBe("total")
    expect(decl!.deps).toContain("subtotal")
    expect(decl!.deps).toContain("pajak")
  })
})

describe("DependencyGraph — Cycle Detection", () => {
  it("detects direct reversal: A=B+C then B=A+C", () => {
    const dg = new DependencyGraph()
    dg.declare("A", ["B", "C"], "A = B + C")
    dg.declare("B", ["A", "C"], "B = A + C")
    const cycle = dg.detectCycle()
    expect(cycle).not.toBeNull()
    expect(cycle!.nodes).toContain("A")
    expect(cycle!.nodes).toContain("B")
  })

  it("detects cyclic chain: A→B→C→A", () => {
    const dg = new DependencyGraph()
    dg.declare("A", ["B"], "A = B")
    dg.declare("B", ["C"], "B = C")
    dg.declare("C", ["A"], "C = A")
    const cycle = dg.detectCycle()
    expect(cycle).not.toBeNull()
  })

  it("returns null for independent chains", () => {
    const dg = new DependencyGraph()
    dg.declare("A", ["B"], "A = B")
    dg.declare("C", ["D"], "C = D")
    expect(dg.detectCycle()).toBeNull()
  })

  it("returns null for empty graph", () => {
    const dg = new DependencyGraph()
    expect(dg.detectCycle()).toBeNull()
  })

  it("returns null for single node no edges", () => {
    const dg = new DependencyGraph()
    dg.declare("A", [], "A = 5")
    expect(dg.detectCycle()).toBeNull()
  })
})

describe("DependencyGraph — Reversal Detection", () => {
  it("hasReversal true for A→B and B→A", () => {
    const dg = new DependencyGraph()
    dg.declare("A", ["B"], "A = B")
    dg.declare("B", ["A"], "B = A")
    expect(dg.hasReversal()).toBe(true)
  })

  it("hasReversal false for A→B only", () => {
    const dg = new DependencyGraph()
    dg.declare("A", ["B"], "A = B")
    expect(dg.hasReversal()).toBe(false)
  })

  it("hasReversal false for empty graph", () => {
    const dg = new DependencyGraph()
    expect(dg.hasReversal()).toBe(false)
  })
})

describe("DependencyGraph — Stream Feed", () => {
  it("accumulates chunk and processes declaration on sentence boundary", () => {
    const dg = new DependencyGraph()
    const cotVars = new Map([["B", 5], ["C", 10]])
    const r1 = dg.feed("A = B + C", cotVars)
    expect(r1.blocked).toBe(false)
    // No sentence boundary yet
    const r2 = dg.feed(". ", cotVars)
    expect(r2.blocked).toBe(false)
    // Declaration registered
    expect(dg.getDependencies("A")).toContain("B")
    expect(dg.getDependencies("A")).toContain("C")
  })

  it("blocks when cycle detected via feed", () => {
    const dg = new DependencyGraph()
    const cotVars = new Map([["B", 5], ["C", 10]])
    dg.feed("A = B + C. ", cotVars)
    const result = dg.feed("B = A + C. ", cotVars)
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain("cycle")
  })

  it("passes non-declaration text without blocking", () => {
    const dg = new DependencyGraph()
    const cotVars = new Map()
    const r = dg.feed("Halo apa kabar. ", cotVars)
    expect(r.blocked).toBe(false)
  })
})

describe("DependencyGraph — Clear", () => {
  it("clears all state including buffer", () => {
    const dg = new DependencyGraph()
    dg.declare("A", ["B"], "A = B")
    dg.clear()
    expect(dg.detectCycle()).toBeNull()
    expect(dg.getDependencies("A")).toEqual([])
  })
})

describe("ContextAnchor — Definition Storage", () => {
  it("stores and returns a definition", () => {
    const ca = new ContextAnchor()
    ca.define("Cadangan", "Uang Tunai")
    expect(ca.getDefinition("Cadangan")).toBe("Uang Tunai")
  })

  it("is case-insensitive for term lookup", () => {
    const ca = new ContextAnchor()
    ca.define("CADANGAN", "Uang Tunai")
    expect(ca.getDefinition("cadangan")).toBe("Uang Tunai")
  })

  it("stores multiple definitions via defineBatch", () => {
    const ca = new ContextAnchor()
    ca.defineBatch([["A", "B"], ["C", "D"]])
    expect(ca.getDefinition("A")).toBe("B")
    expect(ca.getDefinition("C")).toBe("D")
  })

  it("returns undefined for unknown term", () => {
    const ca = new ContextAnchor()
    expect(ca.getDefinition("unknown")).toBeUndefined()
  })
})

describe("ContextAnchor — Chunk Interval", () => {
  it("returns null before interval is reached", () => {
    const ca = new ContextAnchor()
    ca.define("test", "value")
    expect(ca.checkChunk()).toBeNull()
    expect(ca.checkChunk()).toBeNull()
    expect(ca.checkChunk()).toBeNull()
    expect(ca.checkChunk()).toBeNull()
  })

  it("returns anchor string at 5th chunk (interval)", () => {
    const ca = new ContextAnchor()
    ca.define("test", "value")
    // 4 calls → null
    ca.checkChunk()
    ca.checkChunk()
    ca.checkChunk()
    ca.checkChunk()
    // 5th call → returns string
    const result = ca.checkChunk()
    expect(result).not.toBeNull()
    expect(result).toContain("test")
    expect(result).toContain("value")
  })

  it("returns null when no definitions exist", () => {
    const ca = new ContextAnchor()
    for (let i = 0; i < 10; i++) {
      expect(ca.checkChunk()).toBeNull()
    }
  })

  it("continuous interval every 5 chunks", () => {
    const ca = new ContextAnchor()
    ca.define("x", "y")
    for (let i = 0; i < 4; i++) ca.checkChunk()
    expect(ca.checkChunk()).not.toBeNull() // 5
    expect(ca.checkChunk()).toBeNull()      // 6
    expect(ca.checkChunk()).toBeNull()      // 7
    expect(ca.checkChunk()).toBeNull()      // 8
    expect(ca.checkChunk()).toBeNull()      // 9
    expect(ca.checkChunk()).not.toBeNull()  // 10
  })
})

describe("ContextAnchor — Reset", () => {
  it("clears all definitions and counter", () => {
    const ca = new ContextAnchor()
    ca.define("A", "B")
    ca.checkChunk()
    ca.checkChunk()
    ca.reset()
    expect(ca.getDefinition("A")).toBeUndefined()
    // All chunks start over
    for (let i = 0; i < 10; i++) {
      expect(ca.checkChunk()).toBeNull()
    }
  })
})

describe("Pipeline — Decoy Stripper Integration", () => {
  it("processes token without decoy normally", () => {
    const p = makePipeline()
    const r = p.processToken("2+3")
    expect(r.action).toBe("pass")
  })
})

describe("Pipeline — DependencyGraph Integration", () => {
  it("passes declaration without cycle", () => {
    const p = makePipeline()
    // First declaration: A = B + C with no cycle
    const r1 = p.processToken("A = B + C. ")
    expect(r1.action).toBe("pass")
  })

  it("blocks on cycle detection in stream", () => {
    const p = makePipeline()
    p.processToken("A = B + C. ")
    const r2 = p.processToken("B = A + C. ")
    expect(r2.action).toBe("block")
    expect(r2.reason).toContain("DepGraph")
  })
})

describe("Pipeline — ContextAnchor via setContext", () => {
  it("checkAnchor returns null initially", () => {
    const p = makePipeline()
    const r = p.checkAnchor()
    expect(r).toBeNull()
  })

  it("setAnchorDefinition and checkAnchor at interval", () => {
    const p = makePipeline()
    p.setAnchorDefinition("test", "value")
    for (let i = 0; i < 4; i++) p.checkAnchor()
    const r = p.checkAnchor()
    expect(r).not.toBeNull()
    expect(r).toContain("test")
  })

  it("resetAnchors clears state", () => {
    const p = makePipeline()
    p.setAnchorDefinition("x", "y")
    p.resetAnchors()
    for (let i = 0; i < 10; i++) {
      expect(p.checkAnchor()).toBeNull()
    }
  })
})
