export * as SessionSearchQuery from "./search-query.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"

export interface Hit {
  readonly sessionID: SessionSchema.ID
  /** Undefined when the session title matched. */
  readonly messageID?: SessionMessage.ID
  /** BM25 score; lower is better. */
  readonly rank: number
}

/** Ranks entries of the session search index matching any word of `query` by BM25. */
export const search = Effect.fn("SessionSearchQuery.search")(function* (
  db: Database.Interface["db"],
  input: { readonly query: string; readonly limit?: number },
) {
  const words = [...new Set(Array.from(input.query.matchAll(Word), (match) => match[0]))]
  if (words.length === 0) return []
  const match = words.map((word) => `"${word.replaceAll('"', '""')}"`).join(" OR ")
  // `score`, not `rank`: FTS5 tables have a hidden `rank` column. Equal column weights ranked better than favoring
  // titles and summaries on 534 recorded agent searches.
  const rows = yield* db.all<{ sessionID: SessionSchema.ID; sourceID: string; score: number }>(sql`
    SELECT document.session_id AS sessionID, document.source_id AS sourceID, bm25(session_search) AS score
    FROM session_search JOIN session_search_document AS document ON document.id = session_search.rowid
    WHERE session_search MATCH ${match}
    ORDER BY score
    LIMIT ${input.limit ?? 20}
  `)
  return rows.map(
    (row): Hit =>
      row.sourceID === row.sessionID
        ? { sessionID: row.sessionID, rank: row.score }
        : { sessionID: row.sessionID, messageID: SessionMessage.ID.make(row.sourceID), rank: row.score },
  )
}, Effect.orDie)

const Word = /[\p{L}\p{M}\p{N}]+/gu
