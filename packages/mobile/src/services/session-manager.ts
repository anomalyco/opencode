import { router } from "expo-router"
import { useCreateRemoteSessionMutation } from "./api/remote/sessions"
import { useCreateLocalSessionMutation } from "./api/local/sessions"

/**
 * Session Manager - Handles session creation and navigation
 * Based on TUI's session management approach
 */
export class SessionManager {
  private createRemoteSession: ReturnType<typeof useCreateRemoteSessionMutation>["mutateAsync"]
  private createLocalSession: ReturnType<typeof useCreateLocalSessionMutation>["mutateAsync"]

  constructor(
    createRemoteSession: ReturnType<typeof useCreateRemoteSessionMutation>["mutateAsync"],
    createLocalSession: ReturnType<typeof useCreateLocalSessionMutation>["mutateAsync"],
  ) {
    this.createRemoteSession = createRemoteSession
    this.createLocalSession = createLocalSession
  }

  /**
   * Generates a meaningful session title with timestamp
   */
  private generateSessionTitle(customTitle?: string): string {
    if (customTitle) return customTitle

    const now = new Date()
    const timeStr = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    const dateStr = now.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    })

    return `Session ${dateStr} ${timeStr}`
  }

  /**
   * Creates a new session and navigates to it
   * Let remote server handle creation, then sync to local
   */
  async createNewSession(title?: string): Promise<string> {
    try {
      const sessionTitle = this.generateSessionTitle(title)

      // Create session on remote server
      const remoteSession = await this.createRemoteSession({
        title: sessionTitle,
      })

      // Sync remote session to local database
      await this.createLocalSession({
        id: remoteSession.id,
        parentId: remoteSession.parentId || null,
        title: remoteSession.title,
        version: remoteSession.version,
        shareUrl: remoteSession.shareUrl || null,
        timeCreated: new Date(remoteSession.time.created),
        timeUpdated: new Date(remoteSession.time.updated),
        revertMessageId: remoteSession.revertMessageId || null,
        revertPartId: remoteSession.revertPartId || null,
        revertSnapshot: remoteSession.revertSnapshot || null,
        revertDiff: remoteSession.revertDiff || null,
        isSynced: true,
        lastSyncTimestamp: new Date(),
        isFavorite: false,
        localNotes: null,
      })

      return remoteSession.id
    } catch (error) {
      console.error("Failed to create session:", error)
      throw error
    }
  }
  /**
   * Navigates to a new session (creates if needed)
   */
  async navigateToNewSession(title?: string): Promise<void> {
    try {
      const sessionId = await this.createNewSession(title)
      router.push(`/chat/${sessionId}`)
    } catch (error) {
      console.error("Failed to navigate to new session:", error)
      throw error
    }
  }

  /**
   * Switches to an existing session
   */
  switchToSession(sessionId: string): void {
    router.push(`/chat/${sessionId}`)
  }

  /**
   * Clears current session and creates a new one
   * Similar to TUI's "n" key functionality
   */
  async clearAndCreateNew(): Promise<void> {
    await this.navigateToNewSession()
  }
}

/**
 * Hook to get session manager instance
 */
export function useSessionManager() {
  const createRemoteSession = useCreateRemoteSessionMutation()
  const createLocalSession = useCreateLocalSessionMutation()

  return new SessionManager(createRemoteSession.mutateAsync, createLocalSession.mutateAsync)
}
