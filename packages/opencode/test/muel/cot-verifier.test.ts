import { describe, it, expect } from "bun:test"
import { CotVerifier } from "@/muel/cot-verifier"
import { MuelPipeline } from "@/muel/pipeline"

function makePipeline(): MuelPipeline {
  return new MuelPipeline({
    dataProvider: (src) => null,
    ruleocConfig: { rules: [] },
    onAuditEntry: (_entry) => {},
  })
}

describe("CotVerifier — Sentence Splitting", () => {
  it("splits sentences on '. ' correctly", () => {
    const cv = new CotVerifier()
    const r1 = cv.feed("Langkah 1: 3x5=15. ")
    expect(r1.action).toBe("pass")
    const r2 = cv.feed("Langkah 2: 2+15=17. ")
    expect(r2.action).toBe("pass")
  })

  it("does NOT split on decimal (3.000)", () => {
    const cv = new CotVerifier()
    const r = cv.feed("APBN 2024 Rp 3.000T.")
    expect(r.action).toBe("pass")
  })

  it("splits on newline", () => {
    const cv = new CotVerifier()
    const r1 = cv.feed("Langkah 1: 3x5=15\n")
    expect(r1.action).toBe("pass")
    const r2 = cv.feed("Langkah 2: 2+15=17\n")
    expect(r2.action).toBe("pass")
  })

  it("handles incomplete sentences (no trailing delimiter)", () => {
    const cv = new CotVerifier()
    const r1 = cv.feed("Langkah 1: 3x5=")
    expect(r1.action).toBe("pass")
    const r2 = cv.feed("15")
    expect(r2.action).toBe("pass")
    // Still no delimiter — not yet verified
    const r3 = cv.feed(". ")
    expect(r3.action).toBe("pass")
  })
})

describe("CotVerifier — Step Verification", () => {
  it("passes correct intermediate step", () => {
    const cv = new CotVerifier()
    const r = cv.feed("Langkah 1: 3x5=15. ")
    expect(r.action).toBe("pass")
  })

  it("blocks wrong intermediate step", () => {
    const cv = new CotVerifier()
    const r = cv.feed("Langkah 1: 3x5=20. ")
    expect(r.action).toBe("block")
    expect(r.reason).toContain("3*5")
  })

  it("passes multi-step correct chain", () => {
    const cv = new CotVerifier()
    expect(cv.feed("Langkah 1: 3x5=15. ").action).toBe("pass")
    expect(cv.feed("Langkah 2: 2+15=17. ").action).toBe("pass")
    expect(cv.feed("Langkah 3: 20-3=17. ").action).toBe("pass")
  })

  it("blocks at middle step (cumulative error)", () => {
    const cv = new CotVerifier()
    expect(cv.feed("Langkah 1: 10+5=15. ").action).toBe("pass")
    const r = cv.feed("Langkah 2: 15-3=10. ")
    expect(r.action).toBe("block")
    expect(r.reason).toContain("15-3")
  })

  it("passes text without math", () => {
    const cv = new CotVerifier()
    const r = cv.feed("Ini adalah teks biasa tanpa matematika. ")
    expect(r.action).toBe("pass")
  })

  it("passes sentece with numbers but no '=' sign", () => {
    const cv = new CotVerifier()
    const r = cv.feed("Total APBN 2024 adalah Rp 3.000 triliun. ")
    expect(r.action).toBe("pass")
  })
})

describe("CotVerifier — Variable Tracking", () => {
  it("tracks variable and verifies correct step", () => {
    const cv = new CotVerifier()
    expect(cv.feed("Misalkan a = 10. ").action).toBe("pass")
    expect(cv.feed("Lalu a + 5 = 15. ").action).toBe("pass")
  })

  it("tracks variable and blocks wrong step", () => {
    const cv = new CotVerifier()
    expect(cv.feed("Misalkan b = 10. ").action).toBe("pass")
    const r = cv.feed("Lalu b / 2 = 3. ")
    expect(r.action).toBe("block")
    expect(r.reason).toContain("10/2")
  })

  it("tracks multiple variables", () => {
    const cv = new CotVerifier()
    expect(cv.feed("Misalkan x = 3. ").action).toBe("pass")
    expect(cv.feed("Misalkan y = 4. ").action).toBe("pass")
    expect(cv.feed("Maka x * y = 12. ").action).toBe("pass")
  })

  it("ignores unrecognized variables (no false positive)", () => {
    const cv = new CotVerifier()
    const r = cv.feed("z + 5 = 10. ")
    // z is not tracked, so the expression becomes "z + 5 = 10" — detectAndVerify
    // won't find a numeric match because "z" isn't a number, operator, or paren
    expect(r.action).toBe("pass")
  })

  it("tracks standalone assignments", () => {
    const cv = new CotVerifier()
    expect(cv.feed("x = 10. ").action).toBe("pass")
    expect(cv.feed("x + 5 = 15. ").action).toBe("pass")
  })
})

describe("CotVerifier — verifyFullText (post-stream)", () => {
  it("returns zero violations for correct chain", () => {
    const cv = new CotVerifier()
    const summary = cv.verifyFullText("Langkah 1: 3x5=15. Langkah 2: 2+15=17. Langkah 3: 20-3=17.")
    expect(summary.violations).toBe(0)
    expect(summary.sentencesChecked).toBeGreaterThanOrEqual(3)
  })

  it("detects violations in post-stream analysis", () => {
    const cv = new CotVerifier()
    const summary = cv.verifyFullText("Langkah 1: 3x5=15. Langkah 2: 2+15=18. Langkah 3: 20-3=17.")
    expect(summary.violations).toBe(1)
  })

  it("tracks variables in post-stream analysis", () => {
    const cv = new CotVerifier()
    const summary = cv.verifyFullText("Misalkan a = 10. Lalu a + 5 = 15. Maka a * 2 = 20.")
    expect(summary.violations).toBe(0)
    expect(summary.variablesTracked).toBe(1)
  })

  it("detects variable-based violations in post-stream", () => {
    const cv = new CotVerifier()
    const summary = cv.verifyFullText("Misalkan b = 10. Lalu b / 2 = 3.")
    expect(summary.violations).toBe(1)
  })

  it("handles text without math", () => {
    const cv = new CotVerifier()
    const summary = cv.verifyFullText("Ini adalah teks biasa. Tidak ada matematika di sini.")
    expect(summary.violations).toBe(0)
    expect(summary.sentencesChecked).toBe(2)
  })
})

describe("CotVerifier — Reset", () => {
  it("clears buffer and variables on reset", () => {
    const cv = new CotVerifier()
    cv.feed("Misalkan a = 10. ")
    cv.feed("a + 5 = 15. ")
    expect(cv.getVariables().size).toBe(1)
    cv.reset()
    expect(cv.getVariables().size).toBe(0)
    // After reset, "a" is no longer tracked
    const r = cv.feed("a + 5 = 15. ")
    expect(r.action).toBe("pass") // "a" not tracked, no substitution, passes
  })
})

describe("Pipeline — CoT Integration", () => {
  it("processToken passes with correct CoT steps", () => {
    const p = makePipeline()
    expect(p.processToken("Langkah 1: 3x5=15. ").action).toBe("pass")
    expect(p.processToken("Langkah 2: 2+15=17. ").action).toBe("pass")
  })

  it("CoT catches variable-based error that math gate would miss", () => {
    const p = makePipeline()
    // With a=10, "a + 5 = 18" is only detectable after variable substitution
    expect(p.processToken("Misalkan a = 10. ").action).toBe("pass")
    // Math gate sees "a + 5 = 18" — '+' at start of seg fails parseExpressionOnly
    // CoT substitutes to "10+5=18" → 15≠18 → BLOCK
    const r = p.processToken("a + 5 = 18. ")
    expect(r.action).toBe("block")
  })

  it("CoT passes variable-based expression that math gate would skip", () => {
    const p = makePipeline()
    expect(p.processToken("Misalkan a = 10. ").action).toBe("pass")
    // Math gate would skip "a + 5 = 15" (starts with '+'), but CoT substitutes
    const r = p.processToken("a + 5 = 15. ")
    expect(r.action).toBe("pass")
  })

  it("processToken blocks wrong CoT step", () => {
    const p = makePipeline()
    expect(p.processToken("Langkah 1: 3x5=15. ").action).toBe("pass")
    const r = p.processToken("Langkah 2: 2+15=18. ")
    expect(r.action).toBe("block")
    // Existing math gate catches it before CoT — both are valid
    expect(r.reason).toMatch(/Math violation|CoT/)
  })

  it("processToken blocks wrong step with variables", () => {
    const p = makePipeline()
    expect(p.processToken("Misalkan a = 10. ").action).toBe("pass")
    expect(p.processToken("a + 5 = 15. ").action).toBe("pass")
    const r = p.processToken("a * 2 = 15. ")
    expect(r.action).toBe("block")
    // Variable-substituted expression caught by existing math gate or CoT
    expect(r.reason).toMatch(/Math violation|CoT/)
  })

  it("processToken passes text without math", () => {
    const p = makePipeline()
    const r = p.processToken("Ini adalah teks biasa. ")
    expect(r.action).toBe("pass")
  })

  it("verifyCoT returns summary after processing", () => {
    const p = makePipeline()
    p.processToken("Langkah 1: 3x5=15. ")
    p.processToken("Langkah 2: 2+15=17. ")
    const summary = p.verifyCoT("Langkah 1: 3x5=15. Langkah 2: 2+15=17.")
    expect(summary.violations).toBe(0)
    expect(summary.sentencesChecked).toBe(2)
  })

  it("verifyCoT detects violations independently", () => {
    const p = makePipeline()
    const summary = p.verifyCoT("Langkah 1: 3x5=15. Langkah 2: 2+15=18.")
    expect(summary.violations).toBe(1)
  })

  it("resetCoT clears CoT state", () => {
    const p = makePipeline()
    p.processToken("Misalkan a = 10. ")
    p.resetCoT()
    // After reset, "a" is no longer tracked
    const r = p.processToken("a + 5 = 15. ")
    expect(r.action).toBe("pass")
  })
})
