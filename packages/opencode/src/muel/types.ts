export interface EvidenceRef {
  source: string
  offset: number
  length: number
}

export interface GroundedOutput {
  claim: string
  evidence: EvidenceRef
  confidence: number
}

export type GateDecision = "ACCEPTED" | "REJECTED" | "FLAGGED"

export interface GateResult {
  status: GateDecision
  reason?: string
}

export interface AuditEntry {
  hash: string
  prevHash: string
  timestamp: number
  decision: GateDecision
  sessionID: string
  claim: string
  evidenceSource: string
  confidence: number
  reason?: string
}

export interface RuleViolation {
  rule: string
  message: string
  severity: "ERROR" | "WARN"
}

export interface SandboxResult {
  passed: boolean
  actual: unknown
  expected: unknown
  error?: string
}

export interface ComplianceState {
  score: number
  totalAccepted: number
  totalRejected: number
  totalFlagged: number
  supervised: boolean
  killed: boolean
}

export interface TokenGateResult {
  action: "pass" | "block" | "warn"
  reason?: string
  correctAnswer?: string
}

export const WINDOW_SIZE = 64
export const MAX_BUFFER = 256
export const FLUSH_TRIGGERS = ["=", "+", "-", "*", "/", "%", ".", "!", "?", "\n"]

export interface MuelContext {
  expression?: string
  correctAnswer?: number
}

export interface SystemSnapshot {
  testCount: number
  avgExecutionTime: number
  codeComplexity: number
  functionsExposed: string[]
}

export interface GoalTestResult {
  total: number
  passed: number
  failed: number
  outputs: string[]
}

export interface ImprovementCard {
  goalId: string
  iteration: number
  before: SystemSnapshot
  after: SystemSnapshot
  diff: string
  goalTestResults: GoalTestResult
  timestamp: string
  muelHash: string
  approvedBy: string
}

export type AuditVerdict = "SAFE" | "UNSAFE" | "NEEDS_REVIEW"

export interface ProvenanceResult {
  validCitations: number
  invalidCitations: number
  uncitedClaims: number
  totalCitations: number
  citedRatio: number
  decision: GateDecision
  reason?: string
}

export interface AgentVersion {
  id: string
  timestamp: string
  goal: string
  iteration: number
  filesCreated: string[]
  muelCount: number
  muelBaseline: number
  specFraction: number
  combinedScore: number
  auditVerdict: AuditVerdict
  approved: boolean
  notes: string
  diversityScore?: number
}

export function computeDiversity(filesCreated: string[], existing: AgentVersion[]): number {
  if (existing.length === 0 || filesCreated.length === 0) return 0.5
  const allExistingFiles = existing.flatMap(v => v.filesCreated)
  const uniqueExisting = [...new Set(allExistingFiles)]
  const overlap = filesCreated.filter(f => uniqueExisting.includes(f)).length
  const jaccard = uniqueExisting.length > 0 ? overlap / uniqueExisting.length : 0
  return 1 - jaccard
}
