import { describe, expect, it } from "bun:test"
import { QualityGateEvaluator, QualityGateMetrics, SDLCPhase, SDLCPhases } from "../../src/sdlc"

describe("SDLC Engine", () => {
  it("defines 16 SDLC phases with correct thresholds", () => {
    expect(SDLCPhases.length).toBe(16)
    const phase0 = SDLCPhases[0]
    expect(phase0.id).toBe(0)
    expect(phase0.name).toBe("Existing Project Analysis")
    expect(phase0.level).toBe("Critical")
    expect(phase0.requiredPassingPercentage).toBe(100)
  })

  it("passes critical phase quality gate when 100% compliant", () => {
    const phase0 = SDLCPhases[0]
    const metrics = new QualityGateMetrics({
      buildPassing: true,
      typecheckPassing: true,
      testPassingRate: 100,
      securityPassing: true,
    })

    const result = QualityGateEvaluator.evaluate(phase0, metrics)
    expect(result.passed).toBe(true)
    expect(result.score).toBe(100)
    expect(result.failures.length).toBe(0)
  })

  it("fails critical phase quality gate when security check fails", () => {
    const phase0 = SDLCPhases[0]
    const metrics = new QualityGateMetrics({
      buildPassing: true,
      typecheckPassing: true,
      testPassingRate: 100,
      securityPassing: false,
    })

    const result = QualityGateEvaluator.evaluate(phase0, metrics)
    expect(result.passed).toBe(false)
    expect(result.failures).toContain("Security or secrets leakage vulnerability detected.")
  })

  it("passes standard phase quality gate at 90% threshold", () => {
    const phase9 = SDLCPhases.find((p) => p.id === 9)!
    expect(phase9.level).toBe("Standard")
    expect(phase9.requiredPassingPercentage).toBe(90)

    const metrics = new QualityGateMetrics({
      buildPassing: true,
      typecheckPassing: true,
      testPassingRate: 75,
      securityPassing: true,
    })

    const result = QualityGateEvaluator.evaluate(phase9, metrics)
    expect(result.score).toBe(90)
    expect(result.passed).toBe(true)
  })
})
