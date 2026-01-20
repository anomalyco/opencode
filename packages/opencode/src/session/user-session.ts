import z from "zod"

/**
 * User authentication session management.
 *
 * Provides in-memory storage for authenticated user sessions,
 * separate from AI conversation sessions in session/index.ts.
 *
 * Sessions are lost on server restart (acceptable per design).
 */
export namespace UserSession {
  export const Info = z
    .object({
      id: z.string(),
      username: z.string(),
      uid: z.number().optional(), // UNIX user ID
      gid: z.number().optional(), // UNIX primary group ID
      home: z.string().optional(), // Home directory
      shell: z.string().optional(), // Login shell
      createdAt: z.number(),
      lastAccessTime: z.number(),
      userAgent: z.string().optional(),
    })
    .meta({ ref: "UserSessionInfo" })

  export type Info = z.infer<typeof Info>

  // Primary session storage: sessionId -> Info
  const sessions = new Map<string, Info>()

  // Secondary index for "logout everywhere": username -> Set<sessionId>
  const sessionsByUser = new Map<string, Set<string>>()

  /**
   * Create a new session for a user.
   *
   * @param username - The username for the session
   * @param maybeUserAgent - Optional User-Agent string from the client
   * @param maybeUserInfo - Optional UNIX user info (uid, gid, home, shell)
   */
  export function create(
    username: string,
    maybeUserAgent?: string,
    maybeUserInfo?: { uid: number; gid: number; home: string; shell: string },
  ): Info {
    const id = crypto.randomUUID()
    const now = Date.now()
    const session: Info = {
      id,
      username,
      uid: maybeUserInfo?.uid,
      gid: maybeUserInfo?.gid,
      home: maybeUserInfo?.home,
      shell: maybeUserInfo?.shell,
      createdAt: now,
      lastAccessTime: now,
      userAgent: maybeUserAgent,
    }

    sessions.set(id, session)

    const userSessions = sessionsByUser.get(username) ?? new Set()
    userSessions.add(id)
    sessionsByUser.set(username, userSessions)

    return session
  }

  /**
   * Get a session by ID.
   */
  export function get(id: string): Info | undefined {
    return sessions.get(id)
  }

  /**
   * Update lastAccessTime for a session.
   * Returns true if session exists and was updated, false otherwise.
   */
  export function touch(id: string): boolean {
    const session = sessions.get(id)
    if (!session) return false

    session.lastAccessTime = Date.now()
    return true
  }

  /**
   * Remove a session by ID.
   * Returns true if session existed and was removed, false otherwise.
   */
  export function remove(id: string): boolean {
    const session = sessions.get(id)
    if (!session) return false

    sessions.delete(id)

    const userSessions = sessionsByUser.get(session.username)
    if (userSessions) {
      userSessions.delete(id)
      if (userSessions.size === 0) {
        sessionsByUser.delete(session.username)
      }
    }

    return true
  }

  /**
   * Remove all sessions for a user (logout everywhere).
   * Returns the count of removed sessions.
   */
  export function removeAllForUser(username: string): number {
    const userSessions = sessionsByUser.get(username)
    if (!userSessions) return 0

    const count = userSessions.size
    for (const id of userSessions) {
      sessions.delete(id)
    }
    sessionsByUser.delete(username)

    return count
  }
}
