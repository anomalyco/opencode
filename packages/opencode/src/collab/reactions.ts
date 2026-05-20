/**
 * Reactions on prompt suggestions.
 *
 * Distinct from CollabVoteTable (the Vote-Pool ▲ count): reactions are
 * lightweight emoji ack signals that any non-Viewer can add to any
 * suggestion in any queue mode.  Toggling is a per-(suggestion,
 * reactor, emoji) tuple — adding the same emoji twice with the same
 * reactor removes it.
 */

import { and, eq, Database } from "@/storage/db"
import { CollabReactionTable } from "./schema.sql"
import { REACTION_EMOJIS, type ReactionEmoji } from "@opencode-ai/collab"

export function isAllowedEmoji(s: string): s is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(s)
}

/**
 * Toggle a reaction.  Returns the new full reaction map for the
 * suggestion ({ emoji: [logins] }), already collapsed for SSE
 * broadcast.
 */
export function toggleReaction(
  suggestionId: string,
  voterLogin: string,
  emoji: string,
): { added: boolean; reactions: Record<string, string[]> } {
  return Database.use((db) => {
    // Has the user already reacted with this emoji?
    const existing = db
      .select()
      .from(CollabReactionTable)
      .where(
        and(
          eq(CollabReactionTable.suggestion_id, suggestionId),
          eq(CollabReactionTable.voter_github_login, voterLogin),
          eq(CollabReactionTable.emoji, emoji),
        ),
      )
      .get()

    let added: boolean
    if (existing) {
      db.delete(CollabReactionTable)
        .where(
          and(
            eq(CollabReactionTable.suggestion_id, suggestionId),
            eq(CollabReactionTable.voter_github_login, voterLogin),
            eq(CollabReactionTable.emoji, emoji),
          ),
        )
        .run()
      added = false
    } else {
      db.insert(CollabReactionTable)
        .values({
          suggestion_id: suggestionId,
          voter_github_login: voterLogin,
          emoji,
          created_at: Date.now(),
        })
        .run()
      added = true
    }

    return { added, reactions: getReactions(suggestionId, db) }
  })
}

/**
 * Read the full reaction map for a suggestion: { emoji: [reactor logins] }.
 * Only includes emojis that have at least one reactor.
 */
export function getReactions(
  suggestionId: string,
  db?: ReturnType<typeof Database.use<any>>,
): Record<string, string[]> {
  const fn = (innerDb: any) => {
    const rows = innerDb
      .select()
      .from(CollabReactionTable)
      .where(eq(CollabReactionTable.suggestion_id, suggestionId))
      .all() as Array<{ emoji: string; voter_github_login: string }>
    const out: Record<string, string[]> = {}
    for (const row of rows) {
      ;(out[row.emoji] ??= []).push(row.voter_github_login)
    }
    return out
  }
  return db ? fn(db) : Database.use(fn)
}

/**
 * Read reactions for many suggestions at once.  Used by the queue
 * fetch so the client gets reactions in the same payload as the
 * suggestions themselves.
 */
export function getReactionsForSuggestions(
  suggestionIds: string[],
): Record<string, Record<string, string[]>> {
  if (suggestionIds.length === 0) return {}
  return Database.use((db) => {
    const out: Record<string, Record<string, string[]>> = {}
    // No bulk IN-clause helper available; just iterate — pending pools
    // are small (rarely >20 items).
    for (const id of suggestionIds) {
      const map = getReactions(id, db)
      if (Object.keys(map).length > 0) out[id] = map
    }
    return out
  })
}
