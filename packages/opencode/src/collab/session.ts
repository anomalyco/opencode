import { Database, eq, and, isNull } from "@/storage/db"
import {
  CollabSessionTable,
  CollabParticipantTable,
  CollabRepoTable,
} from "./schema.sql"
import { collabId } from "@opencode-ai/collab"
import type { CollabSession, CollabRole, VisibilityMode, QueueMode } from "@opencode-ai/collab"

export interface CreateCollabSessionInput {
  name: string
  ownerGithubId: number
  ownerGithubLogin: string
  ownerAvatarUrl: string
  repos: string[]
  visibilityMode?: VisibilityMode
  queueMode?: QueueMode
  /** Git branch to create/check out in every linked repo. */
  branch?: string
}

/**
 * Build a git-safe branch name from a free-text session name.
 * Lowercases, replaces non [a-z0-9-/_] with "-", trims dashes, caps length.
 * Refs can't be empty / start with - / contain ".." / end with ".lock".
 */
function defaultBranchName(sessionName: string, sessionId: string): string {
  const slug = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9-_/]+/g, "-")
    .replace(/^[-./]+|[-./]+$/g, "")
    .replace(/\.lock$/i, "")
    .slice(0, 40)
  const suffix = sessionId.slice(-6)
  return `collab/${slug || "session"}-${suffix}`
}

export function createCollabSession(input: CreateCollabSessionInput): CollabSession {
  const id = collabId("cs")
  const now = Date.now()
  const branch = (input.branch?.trim() || defaultBranchName(input.name, id)).slice(0, 100)

  Database.transaction((db) => {
    db.insert(CollabSessionTable).values({
      id,
      owner_github_id: input.ownerGithubId,
      owner_github_login: input.ownerGithubLogin,
      name: input.name,
      visibility_mode: input.visibilityMode ?? "typing",
      queue_mode: input.queueMode ?? "fifo",
      session_id: null,
      branch,
      created_at: now,
      deleted_at: null,
    }).run()

    db.insert(CollabParticipantTable).values({
      collab_session_id: id,
      github_id: input.ownerGithubId,
      github_login: input.ownerGithubLogin,
      github_avatar_url: input.ownerAvatarUrl,
      role: "driver" as CollabRole,
      is_online: false,
      joined_at: now,
    }).run()

    if (input.repos.length > 0) {
      for (const repo of input.repos) {
        db.insert(CollabRepoTable).values({
          id: collabId("rp"),
          collab_session_id: id,
          repo_full_name: repo,
        }).run()
      }
    }
  })

  return getCollabSession(id)!
}

export function getCollabSession(id: string): CollabSession | null {
  return Database.use((db) => {
    const session = db
      .select()
      .from(CollabSessionTable)
      .where(and(eq(CollabSessionTable.id, id), isNull(CollabSessionTable.deleted_at)))
      .get()

    if (!session) return null

    const participants = db
      .select()
      .from(CollabParticipantTable)
      .where(eq(CollabParticipantTable.collab_session_id, id))
      .all()

    const repos = db
      .select()
      .from(CollabRepoTable)
      .where(eq(CollabRepoTable.collab_session_id, id))
      .all()

    return {
      id: session.id,
      name: session.name,
      ownerGithubId: session.owner_github_id,
      ownerGithubLogin: session.owner_github_login,
      visibilityMode: session.visibility_mode,
      queueMode: session.queue_mode,
      sessionId: session.session_id ?? null,
      branch: session.branch ?? null,
      repos: repos.map((r) => r.repo_full_name),
      participants: participants.map((p) => ({
        githubId: p.github_id,
        githubLogin: p.github_login,
        githubAvatarUrl: p.github_avatar_url,
        role: p.role,
        isOnline: Boolean(p.is_online),
        joinedAt: new Date(p.joined_at),
      })),
      createdAt: new Date(session.created_at),
      deletedAt: session.deleted_at ? new Date(session.deleted_at) : null,
      initStatus: (session.init_status ?? "ready") as "pending" | "ready" | "failed",
      initError: session.init_error ?? null,
    } satisfies CollabSession
  })
}

/**
 * Update the workspace init state.  Callers:
 *   - router.ts after a successful initSessionWorkspace → setInitStatus(id, "ready").
 *   - router.ts on initSessionWorkspace failure         → setInitStatus(id, "failed", err.message).
 *   - reinit endpoint resets to "pending" before kicking off again.
 */
export function setInitStatus(
  collabSessionId: string,
  status: "pending" | "ready" | "failed",
  error?: string | null,
): void {
  Database.use((db) => {
    db.update(CollabSessionTable)
      .set({ init_status: status, init_error: error ?? null })
      .where(eq(CollabSessionTable.id, collabSessionId))
      .run()
  })
}

export function listCollabSessions(ownerGithubId?: number): CollabSession[] {
  return Database.use((db) => {
    const rows = ownerGithubId
      ? db
          .select()
          .from(CollabSessionTable)
          .where(
            and(
              eq(CollabSessionTable.owner_github_id, ownerGithubId),
              isNull(CollabSessionTable.deleted_at),
            ),
          )
          .all()
      : db
          .select()
          .from(CollabSessionTable)
          .where(isNull(CollabSessionTable.deleted_at))
          .all()

    return rows.map((r) => getCollabSession(r.id)).filter(Boolean) as CollabSession[]
  })
}

export function linkNativeSession(collabSessionId: string, sessionId: string): void {
  Database.use((db) => {
    db.update(CollabSessionTable)
      .set({ session_id: sessionId })
      .where(eq(CollabSessionTable.id, collabSessionId))
      .run()
  })
}

/**
 * Append `repos` to the collab session's linked-repo list.
 *
 * - Idempotent: existing repos in the set are skipped, returning only the
 *   actually-new ones.  Callers use the returned list to drive
 *   initSessionWorkspace (clone only the new ones, not everything).
 * - Caller is responsible for any access-control checks (Driver-only).
 * - No-op + empty return when the session is soft-deleted.
 */
export function addRepos(collabSessionId: string, repos: string[]): string[] {
  if (repos.length === 0) return []
  return Database.transaction((db) => {
    const session = db
      .select({ id: CollabSessionTable.id })
      .from(CollabSessionTable)
      .where(and(eq(CollabSessionTable.id, collabSessionId), isNull(CollabSessionTable.deleted_at)))
      .get()
    if (!session) return []

    const existing = new Set(
      db
        .select({ name: CollabRepoTable.repo_full_name })
        .from(CollabRepoTable)
        .where(eq(CollabRepoTable.collab_session_id, collabSessionId))
        .all()
        .map((r) => r.name),
    )

    const added: string[] = []
    for (const repo of repos) {
      if (existing.has(repo)) continue
      db.insert(CollabRepoTable)
        .values({ id: collabId("rp"), collab_session_id: collabSessionId, repo_full_name: repo })
        .run()
      added.push(repo)
    }
    return added
  })
}

export function deleteCollabSession(id: string): void {
  Database.use((db) => {
    db.update(CollabSessionTable)
      .set({ deleted_at: Date.now() })
      .where(eq(CollabSessionTable.id, id))
      .run()
  })
}
