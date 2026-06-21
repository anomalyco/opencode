import { Schema } from "effect"

export type ProposalStatus =
  | "SUBMITTED"
  | "VALIDATING"
  | "ACCEPTED"
  | "REJECTED"
  | "HELD"

export type RejectionCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_KEY"
  | "AUTHORITY_VIOLATION"
  | "VALIDATION_TIMEOUT"
  | "VALIDATION_ERROR"
// CONTRADICTS_RECORD excluded from Phase 3 per Architecture Review

export interface ProposalOrigin {
  readonly proposerId: string
  readonly sessionId?: string
  readonly contextHash?: string
}

export interface DecisionProposal {
  readonly id: string
  readonly key: string
  readonly title: string
  readonly context: string
  readonly proposedDecision: string
  readonly consequences: string
  readonly tags: readonly string[]
  readonly origin: ProposalOrigin
  readonly createdAt: number
  readonly status: ProposalStatus
  readonly rejectionReason?: RejectionCode
  readonly validatedAt?: number
  readonly validatorId?: string
  readonly acceptedAt?: number
  readonly rejectedAt?: number
}

export const DecisionProposalSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  title: Schema.String,
  context: Schema.String,
  proposedDecision: Schema.String,
  consequences: Schema.String,
  tags: Schema.Array(Schema.String),
  origin: Schema.Struct({
    proposerId: Schema.String,
    sessionId: Schema.optional(Schema.String),
    contextHash: Schema.optional(Schema.String),
  }),
  createdAt: Schema.Number,
  status: Schema.Literals(["SUBMITTED", "VALIDATING", "ACCEPTED", "REJECTED", "HELD"]),
  rejectionReason: Schema.optional(Schema.Literals([
    "SCHEMA_INVALID",
    "DUPLICATE_KEY",
    "AUTHORITY_VIOLATION",
    "VALIDATION_TIMEOUT",
    "VALIDATION_ERROR",
  ])),
  validatedAt: Schema.optional(Schema.Number),
  validatorId: Schema.optional(Schema.String),
  acceptedAt: Schema.optional(Schema.Number),
  rejectedAt: Schema.optional(Schema.Number),
})
