import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { MuelPipeline } from "./pipeline"
import type { ComplianceState, TokenGateResult, MuelContext, ProvenanceResult } from "./types"
import { EvidenceRegistry } from "./provenance"
import { DecoyStripper } from "./decoy-stripper"
import { DependencyGraph } from "./dependency-graph"
import { ContextAnchor } from "./context-anchor"
import { LogicalCycleDetector } from "./logical-cycle"
import { SemanticFingerprintGuard } from "./semantic-fingerprint"
import type { RuleocCheck } from "./ruleoc"
import { NeuralLink } from "../terminal/bridge/NeuralLink"

export interface Interface {
  readonly pipeline: MuelPipeline
  readonly checkStatus: () => ComplianceState
  readonly isKilled: () => boolean
  readonly gateToken: (chunk: string) => TokenGateResult
  readonly setContext: (ctx: MuelContext) => void
  readonly clearContext: () => void
  readonly evidenceRegistry: EvidenceRegistry
  readonly verifyProvenance: (text: string, sessionID: string) => ProvenanceResult
  readonly resetCoT: () => void
  readonly stripper: DecoyStripper
  readonly depGraph: DependencyGraph
  readonly contextAnchor: ContextAnchor
  readonly logicalCycle: LogicalCycleDetector
  readonly resetLogicalCycle: () => void
  readonly semanticGuard: SemanticFingerprintGuard
  readonly resetSemanticFingerprint: () => void
}

const defaultRules: RuleocCheck[] = [
  (output) => {
    const neg = output.claim.match(/-\d+(?:\.\d+)?/g)
    if (neg && neg.length > 0)
      return `Negative amount detected: ${neg.join(", ")}`
    return null
  },
  (output) => {
    const pcts = output.claim.match(/(\d+(?:\.\d+)?)\s*%/g)
    if (pcts && pcts.length >= 2) {
      const vals = pcts.map(p => parseFloat(p))
      const sum = vals.reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 100) > 1 && Math.abs(sum - 1) > 0.01)
        return `Percentages sum to ${sum.toFixed(1)}%, expected ~100%`
    }
    return null
  },
  (output) => {
    const nums = output.claim.match(/\b\d+\s*\+\s*\d+\s*=\s*\d+\b/g)
    if (nums) {
      for (const expr of nums) {
        const parts = expr.match(/(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)/)
        if (parts && parseInt(parts[1]) + parseInt(parts[2]) !== parseInt(parts[3]))
          return `Sum check failed: ${parts[1]} + ${parts[2]} ≠ ${parts[3]}`
      }
    }
    return null
  },
]

export class Service extends Context.Service<Service, Interface>()("@opencode/Muel") {}

export const layer = Layer.sync(Service, () => {
  const pipeline = new MuelPipeline({
    dataProvider: (src) => evidenceRegistry.getContent(src),
    ruleocConfig: { rules: defaultRules },
    onAuditEntry: (_entry) => {},
  })
  const evidenceRegistry = new EvidenceRegistry()
  pipeline.setEvidenceRegistry(evidenceRegistry)
  const compliance = pipeline.getCompliance()
  const nl = new NeuralLink()
  nl.startListening()
  return {
    pipeline,
    checkStatus: () => compliance.getState(),
    isKilled: () => !compliance.isOperational(),
    gateToken: (chunk: string) => pipeline.processToken(chunk),
    setContext: (ctx) => pipeline.setContext(ctx),
    clearContext: () => pipeline.clearContext(),
    evidenceRegistry,
    verifyProvenance: (text: string, sessionID: string) => pipeline.verifyProvenance(text, sessionID),
    resetCoT: () => pipeline.resetCoT(),
    stripper: new DecoyStripper(),
    depGraph: pipeline.getDepGraph(),
    contextAnchor: pipeline.getContextAnchor(),
    logicalCycle: pipeline.getLogicalCycle(),
    resetLogicalCycle: () => pipeline.resetLogicalCycle(),
    semanticGuard: pipeline.getSemanticGuard(),
    resetSemanticFingerprint: () => pipeline.resetSemanticFingerprint(),
  }
})

export const node = LayerNode.make(layer, [])

export * as Muel from "./service"
