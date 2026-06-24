import { describe, expect, test } from "bun:test"
import { AsymmetryEngine, normalizeFractalDimension } from "@/rsi/asymmetry-engine"

describe("asymmetry-engine", () => {
  test("returns BALANCED_ITERATION with no signals", () => {
    const engine = new AsymmetryEngine()
    const target = engine.compute()
    expect(target.pushTarget).toBe("BALANCED_ITERATION")
    expect(target.availableSignals).toBe(0)
    expect(target.totalSignalSlots).toBe(6)
  })

  test("routes to EXPLORE_FAILURE_BOUNDARY on high fractal dim", () => {
    const engine = new AsymmetryEngine()
    engine.updateSignal("boundaryFractalDimension", 0.8)
    engine.updateSignal("channelLoss", 0.1)
    const target = engine.compute()
    expect(target.pushTarget).toBe("EXPLORE_FAILURE_BOUNDARY")
    expect(target.dominantSignal).toBe("boundaryFractalDimension")
  })

  test("routes to STABILIZE_KNOWLEDGE on moderate channel loss", () => {
    const engine = new AsymmetryEngine()
    engine.updateSignal("boundaryFractalDimension", 0.1)
    engine.updateSignal("channelLoss", 0.6)
    const target = engine.compute()
    expect(target.pushTarget).toBe("STABILIZE_KNOWLEDGE")
    expect(target.dominantSignal).toBe("channelLoss")
  })

  test("triggers EMERGENCY at channelLoss >= 0.8 regardless of other signals", () => {
    const engine = new AsymmetryEngine()
    engine.updateSignal("boundaryFractalDimension", 0.95)
    engine.updateSignal("channelLoss", 0.85)
    const target = engine.compute()
    expect(target.pushTarget).toBe("EMERGENCY_KNOWLEDGE_RECOVERY")
    expect(target.urgency).toBe(1.0)
  })

  test("plugs in future signal without error", () => {
    const engine = new AsymmetryEngine()
    engine.updateSignal("boundaryFractalDimension", 0.3)
    engine.updateSignal("channelLoss", 0.2)
    engine.updateSignal("evaluatorFamiliarity", 0.9)
    const target = engine.compute()
    expect(target.availableSignals).toBe(3)
    expect(target.totalSignalSlots).toBe(6)
    expect(target.pushTarget).toBe("INCREASE_EVALUATOR_PRESSURE")
  })

  test("asymmetryScore is 0 when all signals are 0", () => {
    const engine = new AsymmetryEngine()
    engine.updateSignal("boundaryFractalDimension", 0)
    engine.updateSignal("channelLoss", 0)
    const target = engine.compute()
    expect(target.asymmetryScore).toBe(0)
    expect(target.pushTarget).toBe("BALANCED_ITERATION")
  })

  test("normalizeFractalDimension maps D=1.0 to 0 and D=2.0 to 1", () => {
    expect(normalizeFractalDimension(1.0)).toBe(0.0)
    expect(normalizeFractalDimension(2.0)).toBe(1.0)
    expect(normalizeFractalDimension(1.5)).toBeCloseTo(0.5)
  })

  test("increments iteration counter each call", () => {
    const engine = new AsymmetryEngine()
    engine.updateSignal("channelLoss", 0.1)
    const t1 = engine.compute()
    const t2 = engine.compute()
    expect(t2.iteration).toBe(t1.iteration + 1)
  })
})
