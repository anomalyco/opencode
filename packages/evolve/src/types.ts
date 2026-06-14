/**
 * Core domain types for the self-evolution loop.
 *
 * The loop mutates a single artifact (a skill), evaluates candidates against a
 * dataset, selects a Pareto frontier across competing objectives, gates the
 * survivors against hard constraints, and reports the best improvement. These
 * types are intentionally framework-free so the pure stages (pareto, gates,
 * report) can be unit-tested without any LLM or filesystem.
 */

/** A parsed `SKILL.md` artifact: frontmatter + markdown body. */
export interface Skill {
  /** Logical skill name (from frontmatter `name`, else the directory). */
  name: string
  /** Source path on disk, if loaded from a file. */
  path: string
  /** Parsed frontmatter key/values (shallow). */
  frontmatter: Record<string, unknown>
  /** Markdown body (everything after the frontmatter block). */
  body: string
}

/** One evaluation task the skill is expected to help with. */
export interface EvalCase {
  id: string
  prompt: string
  /** Guidance signals the skill body should cover to handle this case. */
  expectKeywords?: string[]
  /** Anti-patterns the skill should steer away from. */
  forbidKeywords?: string[]
  /** Optional reference answer for an LLM-judge scorer. */
  reference?: string
}

/** A recorded execution outcome — the raw material for reflection. */
export interface Trace {
  caseId: string
  success: boolean
  output: string
  /** Why the case failed (drives the reflection prompt). */
  failureReason?: string
}

export interface Dataset {
  cases: EvalCase[]
  traces: Trace[]
}

/** A proposed skill variant in the search. */
export interface Candidate {
  id: string
  parentId?: string
  generation: number
  skill: Skill
  /** Model's stated rationale for the mutation, when available. */
  rationale?: string
}

export interface CaseScore {
  caseId: string
  /** Normalized 0..1 quality for this case. */
  score: number
  detail?: string
}

/** The objectives the search optimizes over for one candidate. */
export interface Objectives {
  /** Mean case score, maximize. */
  score: number
  /** Fraction of cases considered passing (score >= passThreshold), maximize. */
  passRate: number
  /** Serialized skill size in bytes, minimize. */
  sizeBytes: number
}

export interface EvalResult {
  candidateId: string
  objectives: Objectives
  cases: CaseScore[]
}

export interface GateCheck {
  name: string
  passed: boolean
  reason?: string
}

export interface GateResult {
  passed: boolean
  checks: GateCheck[]
}

export interface EvaluatedCandidate {
  candidate: Candidate
  evaluation: EvalResult
  gate: GateResult
}

export interface GenerationRecord {
  generation: number
  /** Candidates proposed and scored this generation (gate-passing only). */
  evaluated: EvaluatedCandidate[]
  /** Candidate ids on the Pareto frontier after merging with prior survivors. */
  frontier: string[]
  /** Best candidate id by score this generation. */
  best: string
}

export interface RunResult {
  skillName: string
  baseline: EvalResult
  generations: GenerationRecord[]
  best: EvaluatedCandidate
  /** True when best beats baseline on score without regressing pass rate. */
  improvedFromBaseline: boolean
}
