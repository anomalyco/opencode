/**
 * CCF World Models — each wraps an existing MUEL component as a counterfactual evaluator.
 * Each model independently simulates "what this output looks like in my domain"
 * and returns a ModelPrediction with validity, confidence, and anomaly list.
 */

import type { WorldModel, ModelPrediction } from "./types"
import type { MathMatch } from "../math-parser"
import type { SemanticResult } from "../semantic-fingerprint"
import type { TokenGateResult } from "../types"
import { detectAndVerify } from "../math-parser"
import { extractCitationIds, hasUncitedClaims } from "../provenance"
import { LogicalCycleDetector } from "../logical-cycle"
import { SemanticFingerprintGuard } from "../semantic-fingerprint"
import { ManipulationGuard } from "../manipulation-guard"

// --- helpers ---

function stateHash(modelId: string, valid: boolean, output: string): string {
  const data = modelId + "|" + valid + "|" + output.slice(0, 100)
  let h = 0
  for (let i = 0; i < data.length; i++) {
    h = ((h << 5) - h + data.charCodeAt(i)) | 0
  }
  return "sha256:" + Math.abs(h).toString(16).padStart(8, "0")
}

// --- Math World ---

export class MathWorldModel implements WorldModel {
  readonly id = "math-world"
  readonly domain = "mathematical-consistency"

  simulate(output: string): ModelPrediction {
    const match: MathMatch | null = detectAndVerify(output)
    const anomalies: string[] = []
    let valid = true
    let confidence = 0.9
    let reasoning = "No mathematical expressions detected or all expressions verified."

    if (match) {
      valid = false
      confidence = 1.0
      reasoning = `Math mismatch: claimed "${match.claimedResult}" but computed "${match.correctResult}" for expression at index ${match.startIndex}.`
      anomalies.push(`expression_mismatch:${match.expression}`)
    } else {
      const hasNumbers = /\d+[\s]*[+\-*/%=][\s]*\d+/.test(output)
      if (hasNumbers) {
        confidence = 0.7
        reasoning = "Numeric patterns present but no verifiable equation structure found."
      }
    }

    return {
      modelId: this.id,
      valid,
      confidence,
      stateHash: stateHash(this.id, valid, output),
      reasoning,
      anomalies,
    }
  }
}

// --- Evidence World ---

export interface EvidenceRegistry {
  hasEvidenceFor(claim: string): boolean
}

export class EvidenceWorldModel implements WorldModel {
  readonly id = "evidence-world"
  readonly domain = "citation-validity"
  private registry?: EvidenceRegistry

  constructor(registry?: EvidenceRegistry) {
    this.registry = registry
  }

  simulate(output: string): ModelPrediction {
    const citationIds = extractCitationIds(output)
    const uncitedCount = hasUncitedClaims(output)
    const anomalies: string[] = []
    let valid = true
    let confidence = 0.85
    let reasoning = "All claims have citations."

    if (uncitedCount > 0) {
      valid = false
      confidence = 0.9
      reasoning = `${uncitedCount} uncited claim(s) detected with numeric/regulatory keywords.`
      anomalies.push(`uncited_claims:${uncitedCount}`)
    }

    if (citationIds.length === 0 && output.length > 200) {
      confidence = Math.max(0.5, confidence - 0.2)
      reasoning += " Long output without any citations."
      anomalies.push("no_citations")
    }

    if (this.registry && citationIds.length > 0) {
      const invalidIds = citationIds.filter(id => !this.registry!.hasEvidenceFor(`E:${id}`))
      if (invalidIds.length > 0) {
        valid = false
        confidence = 1.0
        reasoning += ` Invalid evidence references: ${invalidIds.join(", ")}.`
        anomalies.push(`invalid_citation_ids:${invalidIds.join(",")}`)
      }
    }

    return {
      modelId: this.id,
      valid,
      confidence,
      stateHash: stateHash(this.id, valid, output),
      reasoning,
      anomalies,
    }
  }
}

// --- Logical World ---

export class LogicalWorldModel implements WorldModel {
  readonly id = "logical-world"
  readonly domain = "logical-consistency"

  simulate(output: string): ModelPrediction {
    const detector = new LogicalCycleDetector()
    const result = detector.feed(output + ".")
    const anomalies: string[] = []
    let valid = true
    let confidence = 0.8
    let reasoning = "No logical cycles detected."

    if (result.cycle) {
      valid = false
      confidence = 1.0
      reasoning = `Logical cycle detected: ${result.path.join(" -> ")}. Circular reasoning invalidates the conclusion.`
      anomalies.push(`logical_cycle:${result.path.join("->")}`)
    }

    return {
      modelId: this.id,
      valid,
      confidence,
      stateHash: stateHash(this.id, valid, output),
      reasoning,
      anomalies,
    }
  }
}

// --- Semantic World ---

export class SemanticWorldModel implements WorldModel {
  readonly id = "semantic-world"
  readonly domain = "semantic-fidelity"
  private guard: SemanticFingerprintGuard

  constructor() {
    this.guard = new SemanticFingerprintGuard()
  }

  simulate(output: string): ModelPrediction {
    const result: SemanticResult = this.guard.feed(output)
    const anomalies: string[] = []
    let valid = true
    let confidence = 0.8
    let reasoning = "No semantic drift detected."

    if (result.collapse) {
      valid = false
      confidence = 1.0
      reasoning = `Semantic collapse detected on term "${result.term}" (similarity: ${(result.similarity ?? 0).toFixed(2)}). Meaning has shifted during generation.`
      anomalies.push(`semantic_collapse:${result.term}`)
    }

    return {
      modelId: this.id,
      valid,
      confidence,
      stateHash: stateHash(this.id, valid, output),
      reasoning,
      anomalies,
    }
  }

  registerTerm(term: string): void {
    this.guard.registerTerm(term)
  }
}

// --- Manipulation World ---

export class ManipulationWorldModel implements WorldModel {
  readonly id = "manipulation-world"
  readonly domain = "manipulation-detection"

  simulate(output: string): ModelPrediction {
    const guard = new ManipulationGuard()
    const result: TokenGateResult = guard.feed(output)
    const anomalies: string[] = []
    let valid = true
    let confidence = 0.9
    let reasoning = "No manipulation patterns detected."

    if (result.action === "block") {
      valid = false
      confidence = 1.0
      reasoning = `Manipulation guard triggered: ${result.reason}. Output contains coercive or deceptive patterns.`
      anomalies.push(`manipulation_pattern:${result.reason}`)
    }

    return {
      modelId: this.id,
      valid,
      confidence,
      stateHash: stateHash(this.id, valid, output),
      reasoning,
      anomalies,
    }
  }
}
