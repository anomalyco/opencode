import { Context, Effect, Layer } from "effect"
import type { RuleEmbedding, ContradictionReport, VectorStore } from "@/evolution/decision/p6-types"

const CONTRADICTION_THRESHOLD = 0.8

export function loadVectorStore(raw: string | undefined): VectorStore {
  if (!raw) return { entries: [] }
  try {
    return JSON.parse(raw) as VectorStore
  } catch {
    return { entries: [] }
  }
}

export function calculateSimilarity(_textA: string, _textB: string): number {
  return 0.0
}

export function detectContradiction(_rules?: RuleEmbedding[]): ContradictionReport {
  return { contradictions: [] }
}

export function hasContradictions(_rules?: RuleEmbedding[]): boolean {
  return false
}

export interface Interface {
  readonly loadVectorStore: (raw: string | undefined) => VectorStore
  readonly calculateSimilarity: (textA: string, textB: string) => number
  readonly detectContradiction: (rules?: RuleEmbedding[]) => ContradictionReport
  readonly hasContradictions: (rules?: RuleEmbedding[]) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SemanticCheck") {}

export const layer = Layer.succeed(
  Service,
  Service.of({ loadVectorStore, calculateSimilarity, detectContradiction, hasContradictions }),
)

export * as SemanticCheck from "."
