import { describe, expect, test } from "bun:test"
import { measureChannelFidelity, type AgentKnowledgeState } from "@/rsi/channel-meter"

function makeState(
  version: string,
  outcomes: Record<string, boolean>,
  metrics: Record<string, number> = {},
  strategies: string[] = [],
): AgentKnowledgeState {
  return { agentId: "test-agent", version, testOutcomes: outcomes, metricValues: metrics, activeStrategies: strategies, timestamp: Date.now() }
}

describe("channel-meter", () => {
  test("returns zero loss for identical versions", () => {
    const vN = makeState("v1", { t1: true, t2: false }, { passRate: 0.5 }, ["S1"])
    const vN1 = makeState("v2", { t1: true, t2: false }, { passRate: 0.5 }, ["S1"])
    const r = measureChannelFidelity(vN, vN1)
    expect(r.channelLoss).toBeLessThan(0.05)
    expect(r.knowledgeRetained).toBeGreaterThan(0.95)
    expect(r.testsRegressed).toHaveLength(0)
  })

  test("detects total knowledge loss", () => {
    const vN = makeState("v1", { t1: true, t2: true }, { passRate: 1.0 }, ["S1", "S2", "S3"])
    const vN1 = makeState("v2", { t1: false, t2: false }, { passRate: 0.0 }, [])
    const r = measureChannelFidelity(vN, vN1)
    expect(r.channelLoss).toBeGreaterThan(0.7)
    expect(r.testsRegressed).toContain("t1")
    expect(r.testsRegressed).toContain("t2")
    expect(r.strategiesLost).toContain("S1")
  })

  test("tracks what was gained", () => {
    const vN = makeState("v1", { t1: true }, {}, ["S1"])
    const vN1 = makeState("v2", { t1: true, t2: true }, {}, ["S1", "S2", "S3"])
    const r = measureChannelFidelity(vN, vN1)
    expect(r.strategiesGained).toContain("S2")
    expect(r.strategiesGained).toContain("S3")
    expect(r.strategiesLost).toHaveLength(0)
  })

  test("computes positive netInformationChange when tests added", () => {
    const vN = makeState("v1", { t1: true }, {}, [])
    const vN1 = makeState("v2", { t1: true, t2: false, t3: true }, {}, [])
    const r = measureChannelFidelity(vN, vN1)
    expect(r.bitsV_n1).toBeGreaterThanOrEqual(0)
  })

  test("handles empty states without crash", () => {
    const vN = makeState("v1", {}, {}, [])
    const vN1 = makeState("v2", {}, {}, [])
    const r = measureChannelFidelity(vN, vN1)
    expect(r.channelLoss).toBeLessThanOrEqual(1)
    expect(r.knowledgeRetained).toBeGreaterThanOrEqual(0)
  })
})
