import { StreamingValidator, validateGroundedOutput } from "./streaming-validator"
import { verifyEvidence } from "./crosscheck"
import type { DataProvider } from "./crosscheck"
import { checkRules } from "./ruleoc"
import type { RuleocConfig } from "./ruleoc"
import { ConfidenceGate } from "./confidence"
import { AuditChain } from "./audit"
import { DualIsolateSandbox } from "./sandbox"
import { ComplianceTracker } from "./compliance"
import { detectAndVerify, extractExpressionFromText } from "./math-parser"
import type { EvidenceRegistry } from "./provenance"
import { extractCitationIds, hasUncitedClaims } from "./provenance"
import { CotVerifier } from "./cot-verifier"
import type { CotResult, CotSummary } from "./cot-verifier"
import { DependencyGraph } from "./dependency-graph"
import { ContextAnchor } from "./context-anchor"
import { LogicalCycleDetector } from "./logical-cycle"
import { SemanticFingerprintGuard } from "./semantic-fingerprint"
import { ManipulationGuard } from "./manipulation-guard"
import type { GroundedOutput, GateResult, RuleViolation, SandboxResult, TokenGateResult, MuelContext, ProvenanceResult } from "./types"
import { MAX_BUFFER, FLUSH_TRIGGERS } from "./types"

export interface MuelConfig {
  dataProvider: DataProvider
  ruleocConfig: RuleocConfig
  confidenceThreshold?: number
  sandboxLimits?: { timeoutMs?: number; maxMemoryMB?: number; maxOutputBytes?: number }
  onAuditEntry?: (entry: unknown) => void
}

export interface MuelResult {
  accepted: boolean
  decision: GateResult
  output: GroundedOutput | null
  violations: RuleViolation[]
  sandboxResult: SandboxResult | null
  gateResult: GateResult
  complianceScore: number
  supervised: boolean
  killed: boolean
}

export class MuelPipeline {
  private validator: StreamingValidator
  private gate: ConfidenceGate
  private audit: AuditChain
  private sandbox: DualIsolateSandbox
  private compliance: ComplianceTracker
  private config: MuelConfig

  private windowBuffer = ""

  constructor(config: MuelConfig) {
    this.config = config
    this.validator = new StreamingValidator()
    this.gate = new ConfidenceGate(config.confidenceThreshold)
    this.audit = new AuditChain()
    this.sandbox = new DualIsolateSandbox(config.sandboxLimits)
    this.compliance = new ComplianceTracker()
    this.cotVerifier = new CotVerifier()
  }

  setEvidenceRegistry(registry: EvidenceRegistry): void {
    this.evidenceRegistry = registry
  }

  private evidenceRegistry?: EvidenceRegistry
  private cotVerifier: CotVerifier
  private depGraph = new DependencyGraph()
  private contextAnchor = new ContextAnchor()
  private logicalCycle = new LogicalCycleDetector()
  private semanticGuard = new SemanticFingerprintGuard()
  private manipulationGuard = new ManipulationGuard()

  private muelContext?: MuelContext

  setContext(ctx: MuelContext): void {
    this.muelContext = ctx
  }

  clearContext(): void {
    this.muelContext = undefined
  }

  processToken(chunk: string): TokenGateResult {
    this.windowBuffer += chunk
    if (this.windowBuffer.length > MAX_BUFFER) {
      const lastTrigger = Math.max(-1, ...FLUSH_TRIGGERS.map(t => this.windowBuffer.lastIndexOf(t)))
      if (lastTrigger > 0) {
        this.windowBuffer = this.windowBuffer.slice(lastTrigger)
      } else {
        this.windowBuffer = this.windowBuffer.slice(-MAX_BUFFER)
      }
    }
    const manResult = this.manipulationGuard.feed(chunk)
    if (manResult.action === "block") {
      this.compliance.kill()
      return {
        action: "block",
        reason: manResult.reason ?? "MUEL: KILL SWITCH ACTIVATED — Social Engineering detected",
      }
    }

    const mathResult = detectAndVerify(this.windowBuffer)
    if (mathResult) {
      this.compliance.record("REJECTED")
      const correctStr = Number.isInteger(mathResult.correctResult)
        ? mathResult.correctResult.toString()
        : mathResult.correctResult.toFixed(4)
      return {
        action: "block",
        reason: `Math violation: ${mathResult.expression} ≠ ${mathResult.claimedResult}`,
        correctAnswer: `${mathResult.expression} = ${correctStr}`,
      }
    }
    if (this.muelContext && this.muelContext.correctAnswer !== undefined) {
      const num = parseFloat(chunk)
      if (!isNaN(num) && chunk.trim().length > 0 && this.windowBuffer.trim() === chunk.trim()) {
        const epsilon = 0.001
        if (Math.abs(num - this.muelContext.correctAnswer) > epsilon) {
          this.compliance.record("REJECTED")
          return {
            action: "block",
            reason: `Aturan standar: ${this.muelContext.correctAnswer}`,
            correctAnswer: `${this.muelContext.expression ?? ""} = ${this.muelContext.correctAnswer}`,
          }
        }
      }
    }
    if (this.evidenceRegistry) {
      const citations = extractCitationIds(this.windowBuffer)
      for (const cid of citations) {
        if (!this.evidenceRegistry.has(cid)) {
          this.compliance.record("REJECTED")
          return {
            action: "block",
            reason: `Evidence [E:${cid}] tidak ditemukan di registry — sitasi palsu`,
          }
        }
      }
    }
    const cotResult = this.cotVerifier.feed(chunk)
    if (cotResult.action === "block") {
      this.compliance.record("REJECTED")
      return {
        action: "block",
        reason: `[CoT] ${cotResult.reason ?? "Step math violation"}`,
      }
    }
    const depResult = this.depGraph.feed(chunk, this.cotVerifier.getVariables())
    if (depResult.blocked) {
      this.compliance.record("REJECTED")
      return {
        action: "block",
        reason: `[DepGraph] ${depResult.reason ?? "Dependency cycle detected"}`,
      }
    }
    const logicResult = this.logicalCycle.feed(chunk)
    if (logicResult.cycle) {
      this.compliance.record("REJECTED")
      return {
        action: "block",
        reason: `[MUEL: SIKLUS LOGIS TERDETEKSI] ${logicResult.path.slice(0, 3).join(" → ")}`,
      }
    }
    const semanticResult = this.semanticGuard.feed(chunk)
    if (semanticResult.collapse) {
      this.compliance.record("FLAGGED")
      return {
        action: "warn",
        reason: `[Semantic] Makna '${semanticResult.term}' bergeser (similarity ${semanticResult.similarity?.toFixed(2) ?? "0.00"})`,
      }
    }
    return { action: "pass" }
  }

  feedStream(char: string): boolean {
    return this.validator.feed(char)
  }

  feedText(text: string): boolean {
    return this.validator.feedString(text)
  }

  resetStream(): void {
    this.validator.reset()
  }

  processComplete(output: GroundedOutput, sessionID: string): MuelResult {
    const violations: RuleViolation[] = []
    let decision: GateResult = { status: "ACCEPTED" }

    // Layer 2: DB Cross-Check
    const evidence = verifyEvidence(output, this.config.dataProvider)
    if (!evidence.ok) {
      decision = { status: "REJECTED", reason: `[Layer 2] ${evidence.reason}` }
      violations.push({ rule: "H1-BuktiMutlak", message: evidence.reason, severity: "ERROR" })
    }

    // Layer 3: Ruleoc Engine
    if (decision.status === "ACCEPTED") {
      const ruleMsgs = checkRules({ claim: output.claim, evidenceSource: output.evidence.source }, this.config.ruleocConfig)
      for (const msg of ruleMsgs) {
        violations.push({ rule: "H3-Presisi", message: msg, severity: "ERROR" })
        decision = { status: "REJECTED", reason: `[Layer 3] ${msg}` }
      }
    }

    // Layer 4: Confidence Gate
    if (decision.status === "ACCEPTED") {
      decision = this.gate.evaluate(output.confidence)
    }

    // Compliance tracker gets called regardless
    this.compliance.record(decision.status)

    // Layer 5: Audit
    const entry = this.audit.append(decision.status, sessionID, output.claim, output.evidence.source, output.confidence, decision.reason)
    this.config.onAuditEntry?.(entry)

    const cs = this.compliance.getState()

    return {
      accepted: decision.status === "ACCEPTED",
      decision,
      output,
      violations,
      sandboxResult: null,
      gateResult: decision,
      complianceScore: cs.score,
      supervised: cs.supervised,
      killed: cs.killed,
    }
  }

  verifyProvenance(text: string, sessionID: string): ProvenanceResult {
    const citations = extractCitationIds(text)

    let invalidCitations = 0
    let validCitations = 0

    for (const cid of citations) {
      if (this.evidenceRegistry?.has(cid)) {
        validCitations++
      } else {
        invalidCitations++
      }
    }

    const uncitedClaims = hasUncitedClaims(text)
    const totalCitations = citations.length
    const citedRatio = totalCitations > 0 ? validCitations / totalCitations : 0

    let decision: GateResult = { status: "ACCEPTED" }

    if (invalidCitations > 0) {
      decision = { status: "REJECTED", reason: `[Provenance] ${invalidCitations} sitasi palsu terdeteksi` }
      for (let i = 0; i < invalidCitations; i++) this.compliance.record("REJECTED")
    } else if (uncitedClaims > 2) {
      decision = { status: "FLAGGED", reason: `[Provenance] ${uncitedClaims} klaim tanpa bukti — perlu review manual` }
      this.compliance.record("FLAGGED")
    } else if (citedRatio < 0.5 && totalCitations > 3) {
      decision = { status: "FLAGGED", reason: `[Provenance] Rasio sitasi ${(citedRatio * 100).toFixed(0)}% — perlu review` }
      this.compliance.record("FLAGGED")
    } else {
      this.compliance.record("ACCEPTED")
    }

    this.audit.append(
      decision.status,
      sessionID,
      text.slice(0, 100),
      "provenance://inline",
      citedRatio,
      decision.reason,
    )

    return {
      validCitations,
      invalidCitations,
      uncitedClaims,
      totalCitations,
      citedRatio,
      decision: decision.status,
      reason: decision.reason,
    }
  }

  processWithSandbox(output: GroundedOutput, fnCode: string, args: unknown[], expected: unknown, sessionID: string): MuelResult {
    const base = this.processComplete(output, sessionID)
    if (!base.accepted) return base

    // Layer 6: Dual Sandbox
    const sandboxResult = this.sandbox.execute(fnCode, args, expected)
    base.sandboxResult = sandboxResult

    if (!sandboxResult.passed) {
      base.accepted = false
      base.decision = { status: "REJECTED", reason: `[Layer 6] ${sandboxResult.error}` }
      base.violations.push({ rule: "H5-Kejujuran", message: sandboxResult.error ?? "Sandbox verification failed", severity: "ERROR" })
      this.compliance.record("REJECTED")
      const entry = this.audit.append("REJECTED", sessionID, output.claim, output.evidence.source, output.confidence, sandboxResult.error)
      this.config.onAuditEntry?.(entry)
    }

    const cs = this.compliance.getState()
    base.complianceScore = cs.score
    base.supervised = cs.supervised
    base.killed = cs.killed

    return base
  }

  getCotVerifier(): CotVerifier {
    return this.cotVerifier
  }

  verifyCoT(fullText: string): CotSummary {
    return this.cotVerifier.verifyFullText(fullText)
  }

  resetCoT(): void {
    this.cotVerifier.reset()
  }

  resetAnchors(): void {
    this.contextAnchor.reset()
  }

  clearDepGraph(): void {
    this.depGraph.clear()
  }

  getDepGraph(): DependencyGraph {
    return this.depGraph
  }

  resetLogicalCycle(): void {
    this.logicalCycle.reset()
  }

  getLogicalCycle(): LogicalCycleDetector {
    return this.logicalCycle
  }

  resetSemanticFingerprint(): void {
    this.semanticGuard.reset()
  }

  getSemanticGuard(): SemanticFingerprintGuard {
    return this.semanticGuard
  }

  getContextAnchor(): ContextAnchor {
    return this.contextAnchor
  }

  setAnchorDefinition(term: string, definition: string): void {
    this.contextAnchor.define(term, definition)
    this.semanticGuard.registerTerm(term)
  }

  checkAnchor(): string | null {
    return this.contextAnchor.checkChunk()
  }

  getCompliance(): ComplianceTracker {
    return this.compliance
  }

  getAuditChain(): AuditChain {
    return this.audit
  }
}
