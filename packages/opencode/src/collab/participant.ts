import { Database, eq, and } from "@/storage/db"
import { CollabParticipantTable } from "./schema.sql"
import type { CollabRole, Participant } from "@opencode-ai/collab"

export function addParticipant(
  collabSessionId: string,
  participant: Omit<Participant, "isOnline" | "joinedAt">,
): Participant {
  const now = Date.now()
  Database.use((db) => {
    db.insert(CollabParticipantTable)
      .values({
        collab_session_id: collabSessionId,
        github_id: participant.githubId,
        github_login: participant.githubLogin,
        github_avatar_url: participant.githubAvatarUrl,
        role: participant.role,
        is_online: false,
        joined_at: now,
      })
      .onConflictDoUpdate({
        target: [CollabParticipantTable.collab_session_id, CollabParticipantTable.github_id],
        set: { role: participant.role, github_avatar_url: participant.githubAvatarUrl },
      })
      .run()
  })
  return { ...participant, isOnline: false, joinedAt: new Date(now) }
}

export function changeRole(collabSessionId: string, githubId: number, role: CollabRole): void {
  Database.use((db) => {
    db.update(CollabParticipantTable)
      .set({ role })
      .where(
        and(
          eq(CollabParticipantTable.collab_session_id, collabSessionId),
          eq(CollabParticipantTable.github_id, githubId),
        ),
      )
      .run()
  })
}

export function setOnline(collabSessionId: string, githubId: number, online: boolean): void {
  Database.use((db) => {
    db.update(CollabParticipantTable)
      .set({ is_online: online })
      .where(
        and(
          eq(CollabParticipantTable.collab_session_id, collabSessionId),
          eq(CollabParticipantTable.github_id, githubId),
        ),
      )
      .run()
  })
}

export function getParticipant(collabSessionId: string, githubId: number): Participant | null {
  return Database.use((db) => {
    const row = db
      .select()
      .from(CollabParticipantTable)
      .where(
        and(
          eq(CollabParticipantTable.collab_session_id, collabSessionId),
          eq(CollabParticipantTable.github_id, githubId),
        ),
      )
      .get()
    if (!row) return null
    return {
      githubId: row.github_id,
      githubLogin: row.github_login,
      githubAvatarUrl: row.github_avatar_url,
      role: row.role,
      isOnline: Boolean(row.is_online),
      joinedAt: new Date(row.joined_at),
    }
  })
}
