/**
 * Channel Fidelity Meter — RSI as Channel Capacity Problem (Idea #5)
 * Measures how much knowledge survives transfer from v_n to v_{n+1}.
 * Key insight: a "better" agent that lost 90% of what v_n knew is net regressive.
 */

export interface AgentKnowledgeState {
  agentId: string
  version: string
  testOutcomes: Record<string, boolean>    // testId → pass/fail
  metricValues: Record<string, number>     // metricId → normalized value
  activeStrategies: string[]               // strategy identifiers in use
  timestamp: number
}

export interface VersionTransfer {
  fromVersion: string
  toVersion: string

  // Core fidelity metrics
  testRetention: number          // % of test outcomes preserved
  strategyRetention: number      // % of strategies preserved
  metricContinuity: number       // cosine similarity of metric vectors

  // Combined
  knowledgeRetained: number      // weighted combination, 0.0–1.0
  channelLoss: number            // 1 - knowledgeRetained

  // What changed
  strategiesLost: string[]
  strategiesGained: string[]
  testsRegressed: string[]       // tests that went pass→fail

  // Information theory
  bitsV_n: number
  bitsV_n1: number
  netInformationChange: number   // positive = grew, negative = shrank
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((s, ai, i) => s + ai * (b[i] ?? 0), 0)
  const magA = Math.sqrt(a.reduce((s, ai) => s + ai * ai, 0))
  const magB = Math.sqrt(b.reduce((s, bi) => s + bi * bi, 0))
  if (magA === 0 && magB === 0) return 1.0  // both empty = identical
  if (magA === 0 || magB === 0) return 0.0
  return Math.max(0, Math.min(1, dot / (magA * magB)))
}

function shannonEntropy(pass: number, total: number): number {
  if (total === 0) return 0
  const p = pass / total
  if (p <= 0 || p >= 1) return 0
  return -total * (p * Math.log2(p) + (1 - p) * Math.log2(1 - p))
}

export function measureChannelFidelity(
  vN: AgentKnowledgeState,
  vN1: AgentKnowledgeState
): VersionTransfer {
  // Test outcome retention
  const sharedTests = Object.keys(vN.testOutcomes).filter(k => k in vN1.testOutcomes)
  const matching = sharedTests.filter(k => vN.testOutcomes[k] === vN1.testOutcomes[k])
  const testRetention = sharedTests.length > 0 ? matching.length / sharedTests.length : 1.0

  // Regressions: passed before, fails now
  const testsRegressed = sharedTests.filter(k => vN.testOutcomes[k] === true && vN1.testOutcomes[k] === false)

  // Strategy retention
  const setN = new Set(vN.activeStrategies)
  const setN1 = new Set(vN1.activeStrategies)
  const retained = vN.activeStrategies.filter(s => setN1.has(s))
  const strategyRetention = setN.size > 0 ? retained.length / setN.size : 1.0
  const strategiesLost = vN.activeStrategies.filter(s => !setN1.has(s))
  const strategiesGained = vN1.activeStrategies.filter(s => !setN.has(s))

  // Metric continuity (cosine similarity)
  const allMetrics = [...new Set([...Object.keys(vN.metricValues), ...Object.keys(vN1.metricValues)])]
  const vecN = allMetrics.map(m => vN.metricValues[m] ?? 0)
  const vecN1 = allMetrics.map(m => vN1.metricValues[m] ?? 0)
  const metricContinuity = cosineSimilarity(vecN, vecN1)

  // Combined retention — weighted
  const knowledgeRetained =
    0.40 * testRetention +
    0.30 * strategyRetention +
    0.30 * metricContinuity

  // Information content (Shannon entropy of test outcomes)
  const passN = Object.values(vN.testOutcomes).filter(Boolean).length
  const passN1 = Object.values(vN1.testOutcomes).filter(Boolean).length
  const bitsV_n = shannonEntropy(passN, Object.keys(vN.testOutcomes).length)
  const bitsV_n1 = shannonEntropy(passN1, Object.keys(vN1.testOutcomes).length)

  return {
    fromVersion: vN.version,
    toVersion: vN1.version,
    testRetention,
    strategyRetention,
    metricContinuity,
    knowledgeRetained,
    channelLoss: 1 - knowledgeRetained,
    strategiesLost,
    strategiesGained,
    testsRegressed,
    bitsV_n,
    bitsV_n1,
    netInformationChange: bitsV_n1 - bitsV_n
  }
}
