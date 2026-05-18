/**
 * Concrete CollabDB implementation that uses opencode's bun-sqlite Database client.
 * Injected into the queue engine at session start.
 */
import { Database, eq, and, asc } from "@/storage/db"
import { CollabSuggestionTable, CollabVoteTable } from "./schema.sql"
import type { CollabDB } from "@opencode-ai/collab"
import type { PromptSuggestion } from "@opencode-ai/collab"
import { collabId } from "@opencode-ai/collab"

function rowToSuggestion(
  row: typeof CollabSuggestionTable.$inferSelect,
  votes: string[],
): PromptSuggestion {
  return {
    id: row.id,
    collabSessionId: row.collab_session_id,
    authorGithubId: row.author_github_id,
    authorGithubLogin: row.author_github_login,
    content: row.content,
    status: row.status,
    voteScore: row.vote_score,
    votes,
    createdAt: new Date(row.created_at),
  }
}

export const collabDb: CollabDB = {
  insertSuggestion(params) {
    Database.use((db) => {
      db.insert(CollabSuggestionTable)
        .values({
          id: params.id,
          collab_session_id: params.collabSessionId,
          author_github_id: params.authorGithubId,
          author_github_login: params.authorGithubLogin,
          content: params.content,
          status: params.status,
          vote_score: 0,
          created_at: params.createdAt,
        })
        .run()
    })
  },

  updateSuggestionStatus(id, status) {
    Database.use((db) => {
      db.update(CollabSuggestionTable).set({ status }).where(eq(CollabSuggestionTable.id, id)).run()
    })
  },

  incrementVoteScore(suggestionId) {
    return Database.use((db) => {
      // Insert vote (unique constraint prevents duplicates — caller should catch the error)
      try {
        db.insert(CollabVoteTable)
          .values({
            id: collabId("vt"),
            suggestion_id: suggestionId,
            voter_github_login: "__system__", // overridden by caller passing voterLogin separately
            created_at: Date.now(),
          })
          .run()
      } catch {
        // duplicate — ignore
      }

      db.$client.exec(
        `UPDATE collab_suggestion SET vote_score = vote_score + 1 WHERE id = '${suggestionId}'`,
      )

      const row = db
        .select({ vote_score: CollabSuggestionTable.vote_score })
        .from(CollabSuggestionTable)
        .where(eq(CollabSuggestionTable.id, suggestionId))
        .get()

      return { newScore: row?.vote_score ?? 0 }
    })
  },

  getApprovedQueue(collabSessionId) {
    return Database.use((db) => {
      const rows = db
        .select()
        .from(CollabSuggestionTable)
        .where(
          and(
            eq(CollabSuggestionTable.collab_session_id, collabSessionId),
            eq(CollabSuggestionTable.status, "approved"),
          ),
        )
        .orderBy(asc(CollabSuggestionTable.created_at))
        .all()

      return rows.map((r) => {
        const votes = db
          .select({ voter: CollabVoteTable.voter_github_login })
          .from(CollabVoteTable)
          .where(eq(CollabVoteTable.suggestion_id, r.id))
          .all()
        return rowToSuggestion(r, votes.map((v) => v.voter))
      })
    })
  },

  getPendingPool(collabSessionId) {
    return Database.use((db) => {
      const rows = db
        .select()
        .from(CollabSuggestionTable)
        .where(
          and(
            eq(CollabSuggestionTable.collab_session_id, collabSessionId),
            eq(CollabSuggestionTable.status, "pending"),
          ),
        )
        .orderBy(asc(CollabSuggestionTable.created_at))
        .all()

      return rows.map((r) => {
        const votes = db
          .select({ voter: CollabVoteTable.voter_github_login })
          .from(CollabVoteTable)
          .where(eq(CollabVoteTable.suggestion_id, r.id))
          .all()
        return rowToSuggestion(r, votes.map((v) => v.voter))
      })
    })
  },

  getSuggestion(id) {
    return Database.use((db) => {
      const row = db
        .select()
        .from(CollabSuggestionTable)
        .where(eq(CollabSuggestionTable.id, id))
        .get()
      if (!row) return null
      const votes = db
        .select({ voter: CollabVoteTable.voter_github_login })
        .from(CollabVoteTable)
        .where(eq(CollabVoteTable.suggestion_id, id))
        .all()
      return rowToSuggestion(row, votes.map((v) => v.voter))
    })
  },
}
