import { describe, it, expect } from "bun:test"
import { StreamingValidator, validateGroundedOutput } from "@/muel/streaming-validator"
import { verifyEvidence } from "@/muel/crosscheck"
import { makeSumRule, checkRules } from "@/muel/ruleoc"
import type { RuleocConfig } from "@/muel/ruleoc"
import { ConfidenceGate } from "@/muel/confidence"
import { AuditChain } from "@/muel/audit"
import { DualIsolateSandbox } from "@/muel/sandbox"
import { ComplianceTracker } from "@/muel/compliance"
import { MuelPipeline } from "@/muel/pipeline"

// ─── Layer 1: Streaming Validator ─────────────────────────────

describe("StreamingValidator", () => {
  it("accepts valid JSON starting with '{'", () => {
    const sv = new StreamingValidator()
    expect(sv.feed("{")).toBe(true)
    expect(sv.status().killed).toBe(false)
  })

  it("rejects non-JSON starting with non-'}'", () => {
    const sv = new StreamingValidator()
    expect(sv.feed("[")).toBe(true) // '[' is valid inside JSON
    sv.reset()
    expect(sv.feedString("hello")).toBe(false)
    expect(sv.status().killReason).toContain("JSON must start with")
  })

  it("tracks braces correctly", () => {
    const sv = new StreamingValidator()
    expect(sv.feedString('{"claim":"test"')).toBe(true)
    expect(sv.status().killed).toBe(false)
  })

  it("rejects unbalanced braces", () => {
    const sv = new StreamingValidator()
    sv.feedString('{"claim":"test"}')
    expect(sv.status().killed).toBe(false)
    sv.feed("}")
    expect(sv.status().killed).toBe(true)
  })
})

describe("validateGroundedOutput", () => {
  it("accepts valid GroundedOutput", () => {
    const result = validateGroundedOutput({
      claim: "Total APBN 2024: Rp 3.000T",
      confidence: 0.95,
      evidence: { source: "db://apbn/2024", offset: 100, length: 50 },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.output.claim).toBe("Total APBN 2024: Rp 3.000T")
      expect(result.output.confidence).toBe(0.95)
    }
  })

  it("rejects missing claim", () => {
    const result = validateGroundedOutput({ confidence: 0.9, evidence: { source: "x", offset: 0, length: 1 } })
    expect(result.ok).toBe(false)
  })

  it("rejects invalid confidence", () => {
    const result = validateGroundedOutput({ claim: "test", confidence: 1.5, evidence: { source: "x", offset: 0, length: 1 } })
    expect(result.ok).toBe(false)
  })

  it("rejects missing evidence.source", () => {
    const result = validateGroundedOutput({ claim: "test", confidence: 0.9, evidence: { offset: 0, length: 1 } })
    expect(result.ok).toBe(false)
  })
})

// ─── Layer 2: DB Cross-Check ──────────────────────────────────

describe("verifyEvidence", () => {
  const db: Record<string, string> = {
    "db://apbn/2024": "Anggaran Pendapatan dan Belanja Negara Tahun 2024 sebesar Rp 3.000 Triliun",
  }

  it("passes when claim found in source", () => {
    const result = verifyEvidence(
      { claim: "Rp 3.000 Triliun", confidence: 0.95, evidence: { source: "db://apbn/2024", offset: 58, length: 16 } },
      (src) => db[src] ?? null,
    )
    expect(result.ok).toBe(true)
  })

  it("rejects when source not found", () => {
    const result = verifyEvidence(
      { claim: "test", confidence: 0.9, evidence: { source: "db://nonexistent", offset: 0, length: 4 } },
      (src) => db[src] ?? null,
    )
    expect(result.ok).toBe(false)
  })

  it("rejects when offset out of range", () => {
    const result = verifyEvidence(
      { claim: "test", confidence: 0.9, evidence: { source: "db://apbn/2024", offset: 999, length: 4 } },
      (src) => db[src] ?? null,
    )
    expect(result.ok).toBe(false)
  })
})

// ─── Layer 3: Ruleoc Engine ───────────────────────────────────

describe("Ruleoc", () => {
  it("validates sum rule", () => {
    const data = new Float64Array([100, 200, 300])
    const total = new Float64Array([600])
    const rule = makeSumRule("total", () => data, () => total)
    expect(rule({ claim: "sum is 600", evidenceSource: "test" })).toBeNull()
  })

  it("detects sum mismatch", () => {
    const data = new Float64Array([100, 200, 300])
    const total = new Float64Array([500])
    const rule = makeSumRule("total", () => data, () => total)
    expect(rule({ claim: "sum is 500", evidenceSource: "test" })).toContain("≠")
  })

  it("checkRules aggregates violations", () => {
    const data = new Float64Array([100, 200])
    const total = new Float64Array([300])
    const badTotal = new Float64Array([999])
    const config: RuleocConfig = {
      rules: [
        makeSumRule("good", () => data, () => total),
        makeSumRule("bad", () => data, () => badTotal),
      ],
    }
    const violations = checkRules({ claim: "test", evidenceSource: "test" }, config)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain("bad")
  })
})

// ─── Layer 4: Confidence Gate ─────────────────────────────────

describe("ConfidenceGate", () => {
  it("accepts confidence >= 0.8", () => {
    const gate = new ConfidenceGate()
    expect(gate.evaluate(0.95).status).toBe("ACCEPTED")
    expect(gate.evaluate(0.8).status).toBe("ACCEPTED")
  })

  it("auto-accepts 1.0", () => {
    const gate = new ConfidenceGate()
    expect(gate.evaluate(1.0).status).toBe("ACCEPTED")
    expect(gate.evaluate(1.0).reason).toContain("Perfect")
  })

  it("flags confidence < 0.8", () => {
    const gate = new ConfidenceGate()
    const result = gate.evaluate(0.5)
    expect(result.status).toBe("FLAGGED")
    expect(result.reason).toContain("Human review")
  })
})

// ─── Layer 5: Audit Chain ─────────────────────────────────────

describe("AuditChain", () => {
  it("appends entries and verifies chain", () => {
    const chain = new AuditChain()
    chain.append("ACCEPTED", "s1", "Claim A", "src://a", 0.95)
    chain.append("REJECTED", "s2", "Claim B", "src://b", 0.3)
    chain.append("FLAGGED", "s3", "Claim C", "src://c", 0.5)
    expect(chain.verifyChain()).toBe(true)
    expect(chain.getChain()).toHaveLength(3)
  })

  it("detects tampered chain", () => {
    const chain = new AuditChain()
    chain.append("ACCEPTED", "s1", "Claim A", "src://a", 0.95)
    const entries = chain.getChain()
    const entry = entries[0] as any
    entry.decision = "FLAGGED"
    expect(chain.verifyChain()).toBe(false)
  })
})

// ─── Layer 6: Dual Sandbox ────────────────────────────────────

describe("DualIsolateSandbox", () => {
  it("executes JS function in vm sandbox", () => {
    const sandbox = new DualIsolateSandbox()
    const result = sandbox.execute(
      "function foo(n) { return n * 2 }",
      [21], 42,
    )
    expect(result.passed).toBe(true)
    expect(result.actual).toBe(42)
  })

  it("detects wrong result", () => {
    const sandbox = new DualIsolateSandbox()
    const result = sandbox.execute(
      "function foo(n) { return n * 3 }",
      [10], 42,
    )
    expect(result.passed).toBe(false)
    expect(result.error).toContain("≠")
  })

  it("timeout on infinite loop", () => {
    const sandbox = new DualIsolateSandbox({ timeoutMs: 100 })
    const result = sandbox.execute(
      "function foo() { while(true) {}; return 42 }",
      [], 42,
    )
    expect(result.passed).toBe(false)
    expect(result.error).toContain("timed out")
  })

  it("executes valid WASM module via sandbox", () => {
    const sandbox = new DualIsolateSandbox()
    const wasmBytes = String.fromCharCode(
      0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7F, 0x7F, 0x01, 0x7F,
      0x03, 0x02, 0x01, 0x00,
      0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
      0x0A, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6A, 0x0B,
    )
    const result = sandbox.execute(wasmBytes, [3, 4], 7)
    expect(result.passed).toBe(true)
    expect(result.actual).toBe(7)
  })

  it("rejects invalid WASM bytes gracefully", () => {
    const sandbox = new DualIsolateSandbox()
    const invalidWasm = String.fromCharCode(0x00, 0x61, 0x73, 0x6D, 0xFF, 0xFF, 0xFF, 0xFF)
    const result = sandbox.execute(invalidWasm, [], 0)
    expect(result.passed).toBe(false)
    expect(result.error).toContain("WASM")
  })

  it("enforces memory limit for WASM module", () => {
    const sandbox = new DualIsolateSandbox({ maxOutputBytes: 1 })
    const wasmBytes = String.fromCharCode(
      0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7F, 0x7F, 0x01, 0x7F,
      0x03, 0x02, 0x01, 0x00,
      0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
      0x0A, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6A, 0x0B,
    )
    const result = sandbox.execute(wasmBytes, [10, 20], 30)
    expect(result.passed).toBe(true)
  })
})

// ─── Compliance Tracker ───────────────────────────────────────

describe("ComplianceTracker", () => {
  it("starts at 100", () => {
    const ct = new ComplianceTracker()
    expect(ct.getState().score).toBe(100)
    expect(ct.isOperational()).toBe(true)
  })

  it("accepted adds +1", () => {
    const ct = new ComplianceTracker()
    ct.record("ACCEPTED")
    expect(ct.getState().score).toBe(100) // capped
    ct.record("ACCEPTED")
    expect(ct.getState().score).toBe(100) // capped at 100
  })

  it("rejected subtracts -3", () => {
    const ct = new ComplianceTracker()
    ct.record("REJECTED")
    expect(ct.getState().score).toBe(97)
    ct.record("REJECTED")
    expect(ct.getState().score).toBe(94)
  })

  it("goes supervised below 70", () => {
    const ct = new ComplianceTracker()
    for (let i = 0; i < 12; i++) ct.record("REJECTED")
    expect(ct.getState().supervised).toBe(true)
  })

  it("kills below 30", () => {
    const ct = new ComplianceTracker()
    for (let i = 0; i < 25; i++) ct.record("REJECTED")
    expect(ct.getState().killed).toBe(true)
  })

  it("flagged subtracts -1", () => {
    const ct = new ComplianceTracker()
    ct.record("FLAGGED")
    expect(ct.getState().score).toBe(99)
  })
})

// ─── Integration: MuelPipeline ────────────────────────────────

describe("MuelPipeline integration", () => {
  it("accepts valid output through all layers", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => src === "db://test" ? "Hello World from database for verification purposes" : null,
      ruleocConfig: { rules: [] },
    })

    const result = pipeline.processComplete(
      { claim: "Hello World", confidence: 0.95, evidence: { source: "db://test", offset: 0, length: 11 } },
      "session-1",
    )

    expect(result.accepted).toBe(true)
    expect(result.decision.status).toBe("ACCEPTED")
    expect(result.complianceScore).toBe(100) // capped at 100
  })

  it("rejects when evidence not found", () => {
    const pipeline = new MuelPipeline({
      dataProvider: () => null,
      ruleocConfig: { rules: [] },
    })

    const result = pipeline.processComplete(
      { claim: "Fake data", confidence: 0.99, evidence: { source: "db://fake", offset: 0, length: 5 } },
      "session-1",
    )

    expect(result.accepted).toBe(false)
    expect(result.decision.status).toBe("REJECTED")
    expect(result.decision.reason).toContain("Layer 2")
  })

  it("rejects low confidence", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => src === "db://test" ? "data" : null,
      ruleocConfig: { rules: [] },
      confidenceThreshold: 0.8,
    })

    const result = pipeline.processComplete(
      { claim: "data", confidence: 0.3, evidence: { source: "db://test", offset: 0, length: 4 } },
      "session-1",
    )

    expect(result.accepted).toBe(false)
    expect(result.decision.status).toBe("FLAGGED")
  })

  it("audit chain is valid after multiple runs", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => src === "db://test" ? "data" : null,
      ruleocConfig: { rules: [] },
    })

    pipeline.processComplete(
      { claim: "data", confidence: 0.95, evidence: { source: "db://test", offset: 0, length: 4 } },
      "session-1",
    )
    pipeline.processComplete(
      { claim: "fake", confidence: 0.1, evidence: { source: "db://fake", offset: 0, length: 4 } },
      "session-2",
    )

    expect(pipeline.getAuditChain().verifyChain()).toBe(true)
    expect(pipeline.getAuditChain().getChain()).toHaveLength(2)
  })

  it("processToken blocks single-number mismatch with context", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => null,
      ruleocConfig: { rules: [] },
    })
    pipeline.setContext({ expression: "2+3*5", correctAnswer: 17 })
    const result = pipeline.processToken("25")
    expect(result.action).toBe("block")
    expect(result.reason).toContain("17")
    expect(result.correctAnswer).toContain("17")
    expect(pipeline.getCompliance().getState().score).toBeLessThan(100)
  })

  it("processToken passes single-number that matches context", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => null,
      ruleocConfig: { rules: [] },
    })
    pipeline.setContext({ expression: "2+3*5", correctAnswer: 17 })
    const result = pipeline.processToken("17")
    expect(result.action).toBe("pass")
  })

  it("processToken passes non-number chunks with context", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => null,
      ruleocConfig: { rules: [] },
    })
    pipeline.setContext({ expression: "2+3*5", correctAnswer: 17 })
    const result = pipeline.processToken("hasilnya adalah 17")
    expect(result.action).toBe("pass")
  })

  it("clearContext disables single-number check", () => {
    const pipeline = new MuelPipeline({
      dataProvider: (src) => null,
      ruleocConfig: { rules: [] },
    })
    pipeline.setContext({ expression: "2+3*5", correctAnswer: 17 })
    pipeline.clearContext()
    const result = pipeline.processToken("25")
    expect(result.action).toBe("pass")
  })
})
