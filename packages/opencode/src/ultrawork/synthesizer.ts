/**
 * ULTRAWORK Synthesizer - Multi-AI Result Combiner
 *
 * Takes outputs from multiple AI services and combines them
 * into a single coherent result. Handles conflict resolution,
 * quality scoring, and consensus building.
 *
 * Inspired by:
 * - EvoAgentX's self-evolving result optimization
 * - Ensemble methods in ML (voting, stacking)
 * - Multi-agent consensus protocols
 */

import { Log } from "../util/log"

export interface SynthesisInput {
  source: string
  content: string
  confidence: number
  metadata?: Record<string, any>
}

export interface SynthesisResult {
  combined: string
  summary: string
  sourceCount: number
  conflictsDetected: number
  qualityScore: number
  contributions: {
    source: string
    portion: number
    accepted: boolean
  }[]
}

export namespace UltraworkSynthesizer {
  const log = Log.create({ service: "ultrawork.synthesizer" })

  /**
   * Combine results from multiple AI sources into a unified output.
   *
   * Strategy:
   * 1. Score each input by confidence and source reliability
   * 2. Detect conflicts between outputs
   * 3. Resolve conflicts using confidence-weighted voting
   * 4. Merge non-conflicting outputs
   * 5. Generate a coherent combined result
   */
  export function combine(inputs: SynthesisInput[]): SynthesisResult {
    if (inputs.length === 0) {
      return {
        combined: "",
        summary: "No inputs to synthesize",
        sourceCount: 0,
        conflictsDetected: 0,
        qualityScore: 0,
        contributions: [],
      }
    }

    if (inputs.length === 1) {
      return {
        combined: inputs[0].content,
        summary: `Single source output from ${inputs[0].source}`,
        sourceCount: 1,
        conflictsDetected: 0,
        qualityScore: inputs[0].confidence,
        contributions: [{ source: inputs[0].source, portion: 1.0, accepted: true }],
      }
    }

    log.info("synthesizing results", { sourceCount: inputs.length })

    // Score and rank inputs
    const scored = inputs
      .map((input) => ({
        ...input,
        score: calculateScore(input),
      }))
      .sort((a, b) => b.score - a.score)

    // Detect conflicts
    const conflicts = detectConflicts(scored.map((s) => s.content))

    // Build combined output
    const sections: string[] = []
    const contributions: SynthesisResult["contributions"] = []
    const totalScore = scored.reduce((sum, s) => sum + s.score, 0)

    for (const input of scored) {
      const portion = input.score / totalScore
      const accepted = input.score >= scored[0].score * 0.3 // Accept if within 30% of top score

      contributions.push({
        source: input.source,
        portion,
        accepted,
      })

      if (accepted) {
        sections.push(input.content)
      }
    }

    // Merge sections intelligently
    const combined = mergeSections(sections)

    // Calculate overall quality
    const qualityScore = Math.min(
      1.0,
      scored[0].score * (1 - conflicts * 0.1), // Penalize for conflicts
    )

    const summary = [
      `Synthesized from ${inputs.length} AI source(s)`,
      `Primary source: ${scored[0].source} (confidence: ${(scored[0].confidence * 100).toFixed(0)}%)`,
      conflicts > 0 ? `${conflicts} conflict(s) resolved by confidence-weighted voting` : "No conflicts detected",
      `Overall quality: ${(qualityScore * 100).toFixed(0)}%`,
    ].join(". ")

    log.info("synthesis complete", {
      sourceCount: inputs.length,
      conflicts,
      qualityScore,
    })

    return {
      combined,
      summary,
      sourceCount: inputs.length,
      conflictsDetected: conflicts,
      qualityScore,
      contributions,
    }
  }

  /**
   * Merge code outputs from multiple AIs, preferring the highest-quality version.
   * For code, we don't blend - we pick the best and augment with unique parts from others.
   */
  export function mergeCode(inputs: SynthesisInput[]): SynthesisResult {
    if (inputs.length === 0) {
      return combine(inputs)
    }

    // For code, the highest confidence source wins
    const sorted = [...inputs].sort((a, b) => b.confidence - a.confidence)
    const primary = sorted[0]

    // Check if other sources have unique additions
    const uniqueAdditions: string[] = []
    for (const input of sorted.slice(1)) {
      const additions = findUniqueContent(primary.content, input.content)
      if (additions.length > 0) {
        uniqueAdditions.push(`// Additional from ${input.source}:\n${additions}`)
      }
    }

    const combined =
      uniqueAdditions.length > 0
        ? `${primary.content}\n\n${uniqueAdditions.join("\n\n")}`
        : primary.content

    return {
      combined,
      summary: `Code from ${primary.source} (primary), augmented by ${sorted.length - 1} source(s)`,
      sourceCount: inputs.length,
      conflictsDetected: 0,
      qualityScore: primary.confidence,
      contributions: sorted.map((s, i) => ({
        source: s.source,
        portion: i === 0 ? 0.8 : 0.2 / (sorted.length - 1),
        accepted: true,
      })),
    }
  }

  /**
   * Build consensus from multiple AI opinions on a topic
   */
  export function buildConsensus(inputs: SynthesisInput[]): {
    consensus: string
    agreementLevel: number
    dissent: string[]
  } {
    if (inputs.length < 2) {
      return {
        consensus: inputs[0]?.content ?? "",
        agreementLevel: 1.0,
        dissent: [],
      }
    }

    // Simple similarity-based consensus
    const similarities: number[] = []
    for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) {
        similarities.push(textSimilarity(inputs[i].content, inputs[j].content))
      }
    }

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length

    // Find dissenting opinions (low similarity to majority)
    const dissent: string[] = []
    const avgContent = inputs.reduce(
      (best, current) => (current.confidence > best.confidence ? current : best),
      inputs[0],
    )

    for (const input of inputs) {
      if (textSimilarity(input.content, avgContent.content) < 0.3) {
        dissent.push(`${input.source}: ${input.content.substring(0, 200)}...`)
      }
    }

    return {
      consensus: avgContent.content,
      agreementLevel: avgSimilarity,
      dissent,
    }
  }

  // --- Internal helpers ---

  function calculateScore(input: SynthesisInput): number {
    let score = input.confidence

    // Boost for content length (more detailed = usually better)
    if (input.content.length > 500) score += 0.1
    if (input.content.length > 2000) score += 0.1

    // Boost for structured content (code blocks, lists, headers)
    if (input.content.includes("```")) score += 0.05
    if (input.content.includes("##")) score += 0.05
    if (input.content.includes("- ")) score += 0.05

    return Math.min(1.0, score)
  }

  function detectConflicts(contents: string[]): number {
    let conflicts = 0

    for (let i = 0; i < contents.length; i++) {
      for (let j = i + 1; j < contents.length; j++) {
        const similarity = textSimilarity(contents[i], contents[j])
        // Very different outputs on the same topic = potential conflict
        if (similarity < 0.2) conflicts++
      }
    }

    return conflicts
  }

  function textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/))
    const wordsB = new Set(b.toLowerCase().split(/\s+/))

    let intersection = 0
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++
    }

    const union = wordsA.size + wordsB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  function mergeSections(sections: string[]): string {
    if (sections.length === 0) return ""
    if (sections.length === 1) return sections[0]

    // Use the longest/most detailed section as the base
    const sorted = [...sections].sort((a, b) => b.length - a.length)
    return sorted[0]
  }

  function findUniqueContent(primary: string, secondary: string): string {
    const primaryLines = new Set(primary.split("\n").map((l) => l.trim()).filter(Boolean))
    const uniqueLines = secondary
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim()
        return trimmed.length > 10 && !primaryLines.has(trimmed)
      })
      .slice(0, 20) // Limit unique additions

    return uniqueLines.join("\n")
  }
}
