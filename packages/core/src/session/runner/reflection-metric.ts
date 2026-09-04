export * as ReflectionMetric from "./reflection-metric"

import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../database/database"
import { MessageTable, PartTable, SessionInputTable } from "../sql"
import { SessionSchema } from "../schema"

type DatabaseService = Database.Interface["db"]

const TOKEN_REGEX = /[A-Za-z0-9_]+/g

export const tokensOf = (text: string): ReadonlySet<string> => {
  const matches = text.toLowerCase().match(TOKEN_REGEX)
  return new Set(matches ?? [])
}

export const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  const union = a.size + b.size - intersection
  if (union === 0) return 1
  return intersection / union
}

const NEGATION_TOKENS = new Set([
  "not",
  "no",
  "never",
  "neither",
  "cannot",
  "cant",
  "wont",
  "stop",
  "abort",
  "failed",
  "failure",
  "contradiction",
  "conflict",
  "invalid",
])

export const hasPolarityDivergence = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  const negA = Array.from(a).filter((t) => NEGATION_TOKENS.has(t)).length
  const negB = Array.from(b).filter((t) => NEGATION_TOKENS.has(t)).length
  return (negA > 0 && negB === 0) || (negB > 0 && negA === 0)
}

export const rho = (a: string, b: string): number => {
  const tokensA = tokensOf(a)
  const tokensB = tokensOf(b)
  const base = 1 - jaccard(tokensA, tokensB)
  if (hasPolarityDivergence(tokensA, tokensB)) return Math.max(base, 0.5)
  return base
}

export const isContradiction = (a: string, b: string): boolean => {
  const tokensA = tokensOf(a)
  const tokensB = tokensOf(b)
  return jaccard(tokensA, tokensB) > 0.4 && hasPolarityDivergence(tokensA, tokensB)
}

export const objectiveGap = (initialPrompt: string, muR: string, tauR: string): number =>
  Math.abs(rho(tauR, initialPrompt) - rho(muR, initialPrompt))

export const initialPrompt = Effect.fn("ReflectionMetric.initialPrompt")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const row = yield* db
    .select({ prompt: SessionInputTable.prompt })
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq)))
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (row) return row.prompt.text

  const firstUser = yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, sessionID))
    .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
    .limit(5)
    .all()
    .pipe(Effect.orDie)
  for (const m of firstUser) {
    if (m.data.role === "user") {
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.message_id, m.id))
        .orderBy(asc(PartTable.id))
        .all()
        .pipe(Effect.orDie)
      const text = parts
        .filter((p) => p.data.type === "text")
        .map((p) => (p.data as { text?: string }).text ?? "")
        .join("\n")
      if (text.trim().length > 0) return text
    }
  }
  return ""
})

export type Cofinality = "omega" | "transfinite"

export const cofinality = (extensionsDetected: number): Cofinality =>
  extensionsDetected > 0 ? "transfinite" : "omega"

