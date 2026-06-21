export interface DiversityMetrics {
  edi: number
  falseConsensusWarning: boolean
  pairwiseSimilarity: Map<string, Map<string, number>>
  perAgentUniqueness: Map<string, number>
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersect = 0
  for (const t of a) {
    if (b.has(t)) intersect++
  }
  const union = a.size + b.size - intersect
  return union === 0 ? 0 : intersect / union
}

export function computeDiversity(proposals: { agentId: string; text: string }[]): DiversityMetrics {
  const tokens = proposals.map((p) => tokenize(p.text))

  const pairwiseSimilarity = new Map<string, Map<string, number>>()
  for (let i = 0; i < proposals.length; i++) {
    const row = new Map<string, number>()
    for (let j = 0; j < proposals.length; j++) {
      row.set(proposals[j].agentId, i === j ? 1 : jaccardSimilarity(tokens[i], tokens[j]))
    }
    pairwiseSimilarity.set(proposals[i].agentId, row)
  }

  let sumSim = 0
  let pairCount = 0
  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      sumSim += jaccardSimilarity(tokens[i], tokens[j])
      pairCount++
    }
  }

  const meanSim = pairCount > 0 ? sumSim / pairCount : 0
  const edi = 1 - meanSim

  const perAgentUniqueness = new Map<string, number>()
  for (let i = 0; i < proposals.length; i++) {
    let simSum = 0
    for (let j = 0; j < proposals.length; j++) {
      if (i === j) continue
      simSum += jaccardSimilarity(tokens[i], tokens[j])
    }
    perAgentUniqueness.set(
      proposals[i].agentId,
      proposals.length > 1 ? 1 - simSum / (proposals.length - 1) : 1,
    )
  }

  return {
    edi,
    falseConsensusWarning: edi < 0.3,
    pairwiseSimilarity,
    perAgentUniqueness,
  }
}
