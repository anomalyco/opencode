/**
 * Core domain types for the AIP-style pipeline.
 *
 * The shape mirrors Palantir Foundry's split between a *semantic layer* (typed
 * objects + links — the ontology), a *kinetic layer* (governed actions that
 * write back), and a *dynamic layer* (learning from outcomes). Everything here
 * is framework-free so the pure stages can be unit-tested without an LLM or the
 * live opencode runtime.
 */

export type PropertyValue = string | number | boolean | null

/** A node kind in the ontology (e.g. Session, Skill, Tool, Agent). */
export interface ObjectType {
  name: string
  /** Declared property keys (used for validation / display). */
  properties: string[]
  /** Property whose value is a human-readable label. */
  titleProperty?: string
}

/** A concrete object instance in the knowledge graph. */
export interface ObjectInstance {
  type: string
  id: string
  properties: Record<string, PropertyValue>
}

/** A relationship kind between two object types (e.g. Agent —has-skill→ Skill). */
export interface LinkType {
  name: string
  from: string
  to: string
}

/** A concrete edge between two object instances. */
export interface Link {
  type: string
  from: string
  to: string
}

/** The unit a kinetic action emits — a write-back proposal, never an in-place mutation. */
export interface ProposedChange {
  kind: "update-property" | "update-skill" | "answer" | "noop"
  summary: string
  targetId?: string
  /** For update-property. */
  property?: string
  value?: PropertyValue
  /** For update-skill write-back. */
  skillPath?: string
  newBody?: string
  before?: string
  after?: string
  /** For answer. */
  answer?: string
}

export type BranchStatus = "proposed" | "approved" | "rejected" | "merged"

/** A reviewable change set — the "action branch" awaiting human review/merge. */
export interface ActionBranch {
  id: string
  actionName: string
  permission: string
  change: ProposedChange
  rationale?: string
  status: BranchStatus
  feedback?: string
}

export interface ReviewDecision {
  decision: "approve" | "reject"
  feedback?: string
}
