import { Context, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { sql } from "drizzle-orm"

export interface LexicalMatch {
  sessionId: string
  messageId: string
  partId?: string
  content: string
  score: number
  role: "user" | "assistant"
  createdAt: number
}

export interface LexicalSearchInput {
  query: string
  sessionIds: string[]
  exact?: boolean
  limit: number
}

interface LexicalSearchInterface {
  search(input: LexicalSearchInput): Effect.Effect<LexicalMatch[], never, Database.Service>
}

interface TextPartRow {
  part_id: string
  message_id: string
  session_id: string
  content: string
  message_created: number
  role: string
  session_title: string | null
  session_updated: number
}

export class LexicalSearch extends Context.Service<LexicalSearch, LexicalSearchInterface>()("@opencode/LexicalSearch") {}

export const layer: Layer.Layer<LexicalSearch, never, Database.Service> = Layer.effect(
  LexicalSearch,
  Effect.gen(function* () {
    const service: LexicalSearchInterface = {
      search(input) {
        return Effect.gen(function* () {
          if (input.sessionIds.length === 0) return []

          const { db } = yield* Database.Service
          const query = buildQuery(input.sessionIds)
          const rows = yield* db.all<TextPartRow>(sql.raw(query)).pipe(Effect.orDie)
          const exactOnly = input.exact === true

          const lowerQuery = input.query.toLowerCase()
          const terms = extractTerms(lowerQuery)
          const now = Date.now()

          const scored = rows
            .map((row) => scoreRow(row, lowerQuery, terms, exactOnly, now))
            .filter((match) => !exactOnly || match.score > 0)

          scored.sort((a, b) => b.score - a.score)
          return scored.slice(0, input.limit)
        })
      },
    }
    return service
  }),
)

function buildQuery(sessionIds: string[]): string {
  const idsList = sessionIds.map((id) => "'" + id.replace(/'/g, "''") + "'").join(", ")

  return `
    SELECT p.id as part_id, p.message_id, p.session_id,
           json_extract(p.data, '$.text') as content,
           m.time_created as message_created,
           json_extract(m.data, '$.role') as role,
           s.title as session_title, s.time_updated as session_updated
    FROM part p
    JOIN message m ON p.message_id = m.id
    JOIN session s ON p.session_id = s.id
    WHERE p.session_id IN (${idsList})
      AND json_extract(p.data, '$.type') = 'text'
      AND json_extract(p.data, '$.text') IS NOT NULL
      AND trim(json_extract(p.data, '$.text')) != ''
    ORDER BY m.time_created DESC
  `
}

function recencyMultiplier(sessionUpdated: number, now: number): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const ageDays = Math.max(0, now - sessionUpdated) / MS_PER_DAY
  return 2.0 - Math.min(1.0, ageDays / 365)
}

function extractTerms(query: string): string[] {
  const unique = new Set<string>()
  const terms = query.split(/\s+/)
  for (const term of terms) {
    if (term.length >= 3) unique.add(term)
  }
  return Array.from(unique)
}

function scoreRow(row: TextPartRow, query: string, terms: string[], exactOnly: boolean, now: number): LexicalMatch {
  const content = row.content
  const lowerContent = content.toLowerCase()
  let score = 0

  if (lowerContent.includes(query)) {
    score += 100
  }

  if (!exactOnly) {
    for (const term of terms) {
      if (lowerContent.includes(term)) {
        score += 3
      }
    }
  }

  if (row.session_title) {
    const lowerTitle = row.session_title.toLowerCase()
    if (lowerTitle.includes(query)) {
      score += 20
    }
  }

  const multiplier = recencyMultiplier(row.session_updated, now)
  score = Math.round(score * multiplier)

  return {
    sessionId: row.session_id,
    messageId: row.message_id,
    partId: row.part_id,
    content: row.content,
    score,
    role: row.role === "assistant" ? "assistant" : "user",
    createdAt: row.message_created,
  }
}
