/**
 * Side-channel team notes — short messages between participants that live
 * only in the collab UI, never reach the LLM.
 *
 * Used as the carrier for @-mentions: the opencode prompt-input inside the
 * iframe owns the `@` key for file/agent mentions, so trying to ping a
 * teammate from there fights the popover and gets eaten before submit.
 * Notes give people a dedicated composer in the left panel for that.
 */

import { Database, eq, and, desc } from "@/storage/db"
import { CollabNoteTable, CollabSessionTable } from "./schema.sql"
import { collabId } from "@opencode-ai/collab"
import type { CollabNote } from "@opencode-ai/collab"
import { isNull } from "drizzle-orm"

/**
 * Insert a note, return the canonical CollabNote shape ready for the
 * SSE broadcast.  Caller is responsible for participant + role checks.
 */
export function insertNote(input: {
  collabSessionId: string
  authorGithubId: number
  authorGithubLogin: string
  content: string
}): CollabNote {
  const id = collabId("nt")
  const now = Date.now()
  Database.use((db) => {
    db.insert(CollabNoteTable)
      .values({
        id,
        collab_session_id: input.collabSessionId,
        author_github_id: input.authorGithubId,
        author_github_login: input.authorGithubLogin,
        content: input.content,
        created_at: now,
      })
      .run()
  })
  return {
    id,
    collabSessionId: input.collabSessionId,
    authorGithubId: input.authorGithubId,
    authorGithubLogin: input.authorGithubLogin,
    content: input.content,
    createdAt: new Date(now),
  }
}

/**
 * Return the last `limit` notes for a session, oldest-first (so the client
 * can append them to a scrolling chat strip in chronological order).
 * Filtered to live sessions (deleted_at IS NULL).
 */
export function listRecentNotes(collabSessionId: string, limit = 100): CollabNote[] {
  return Database.use((db) => {
    // Ensure the session still exists (cascade should have wiped notes if
    // the session was deleted, but double-check defensively).
    const sessionExists = db
      .select({ id: CollabSessionTable.id })
      .from(CollabSessionTable)
      .where(
        and(eq(CollabSessionTable.id, collabSessionId), isNull(CollabSessionTable.deleted_at)),
      )
      .get()
    if (!sessionExists) return []

    const rows = db
      .select()
      .from(CollabNoteTable)
      .where(eq(CollabNoteTable.collab_session_id, collabSessionId))
      .orderBy(desc(CollabNoteTable.created_at))
      .limit(limit)
      .all()
    // Reverse so the result is chronological asc for the UI.
    return rows.reverse().map((r) => ({
      id: r.id,
      collabSessionId: r.collab_session_id,
      authorGithubId: r.author_github_id,
      authorGithubLogin: r.author_github_login,
      content: r.content,
      createdAt: new Date(r.created_at),
    }))
  })
}
