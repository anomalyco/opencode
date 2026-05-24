import { randomUUID } from "crypto"
import { Database, eq } from "@/storage/db"
import { CollabInviteTable } from "./schema.sql"
import type { CollabRole, InviteToken } from "@opencode-ai/collab"

const EXPIRY_HOURS = 72
/** Hard cap on caller-supplied `expiresInHours` (ADR-0008).  A Driver could
 *  otherwise pass an arbitrarily large value and create a permanent join
 *  token; cap at the default expiry. */
export const MAX_EXPIRY_HOURS = 72

export function createInvite(
  collabSessionId: string,
  role: CollabRole,
  createdBy: string,
  expiresInHours = EXPIRY_HOURS,
): InviteToken {
  const token = randomUUID()
  // Coerce to a sane range — reject 0/negative (would expire immediately)
  // and anything beyond the cap (would create a near-permanent invite).
  const hours = Math.min(MAX_EXPIRY_HOURS, Math.max(1, Math.floor(expiresInHours)))
  const expiresAt = Date.now() + hours * 60 * 60 * 1000

  Database.use((db) => {
    db.insert(CollabInviteTable)
      .values({
        token,
        collab_session_id: collabSessionId,
        role,
        created_by: createdBy,
        expires_at: expiresAt,
        used_at: null,
        used_by: null,
      })
      .run()
  })

  return { token, collabSessionId, role, createdBy, expiresAt: new Date(expiresAt), usedAt: null }
}

export function validateInvite(token: string): InviteToken | null {
  return Database.use((db) => {
    const row = db.select().from(CollabInviteTable).where(eq(CollabInviteTable.token, token)).get()
    if (!row) return null
    if (row.used_at) return null
    if (row.expires_at && row.expires_at < Date.now()) return null
    return {
      token: row.token,
      collabSessionId: row.collab_session_id,
      role: row.role,
      createdBy: row.created_by,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      usedAt: null,
    }
  })
}

export function redeemInvite(token: string, usedBy: string): void {
  Database.use((db) => {
    db.update(CollabInviteTable)
      .set({ used_at: Date.now(), used_by: usedBy })
      .where(eq(CollabInviteTable.token, token))
      .run()
  })
}

export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/collab/invite/${token}`
}
