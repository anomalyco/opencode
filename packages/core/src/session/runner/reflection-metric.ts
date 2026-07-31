export * as ReflectionMetric from "./reflection-metric"

import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../database/database"
import { SessionInputTable } from "../sql"
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

export const rho = (a: string, b: string): number => 1 - jaccard(tokensOf(a), tokensOf(b))

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
  if (!row) return ""
  return row.prompt.text
})

export type Cofinality = "omega" | "transfinite"

export const cofinality = (extensionsDetected: number): Cofinality =>
  extensionsDetected > 0 ? "transfinite" : "omega"

