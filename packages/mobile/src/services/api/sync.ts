import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "./keys"
import { apiClient } from "./remote/client"
import { projects } from "@/db/schema"
import { eq } from "drizzle-orm"

// Sync service for coordinating local and remote data
export class SyncService {
  private static instance: SyncService
  private queryClient: any

  private constructor() {}

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService()
    }
    return SyncService.instance
  }

  setQueryClient(client: any) {
    this.queryClient = client
  }

  // Get active project - used by all sync operations
  private async getActiveProject() {
    const db = (await import("../../db")).default
    const activeProject = await db.select().from(projects).where(eq(projects.isActive, true)).limit(1)
    if (!activeProject[0]) {
      throw new Error("No active project found. Please select a project first.")
    }
    return activeProject[0]
  }

  // Optimistic session creation - create locally first, then sync to remote
  async createSessionOptimistic(sessionData: any) {
    const activeProject = await this.getActiveProject()

    // Create locally first for immediate UI feedback
    const localSession = {
      ...sessionData,
      id: `temp_${Date.now()}`, // Temporary ID
      projectId: activeProject.id,
      isSynced: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Update local cache optimistically
    this.queryClient?.setQueryData(queryKeys.local.sessions.lists(), (old: any[]) => [localSession, ...(old || [])])

    try {
      // Ensure API client is using the active project's server URL
      await apiClient.updateBaseUrl(activeProject.serverHostname, activeProject.serverPort)

      // Sync to remote
      await apiClient.axios.post("/session", sessionData)

      // Invalidate queries to refresh with real data
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.remote.sessions.all })

      return sessionData
    } catch (error) {
      // Remove optimistic update on failure
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
      throw error
    }
  }

  // Sync local sessions to remote
  async syncSessionsToRemote() {
    try {
      const activeProject = await this.getActiveProject()

      // Import the session repository to get unsynced sessions
      const { eq, and } = await import("drizzle-orm")
      const db = (await import("../../db")).default
      const { sessions } = await import("../../db/schema")

      // Ensure API client is using the active project's server URL
      await apiClient.updateBaseUrl(activeProject.serverHostname, activeProject.serverPort)

      // Get unsynced local sessions for the active project only
      const unsyncedSessions = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.projectId, activeProject.id), eq(sessions.isSynced, false)))

      for (const session of unsyncedSessions || []) {
        try {
          // Create on remote
          await apiClient.axios.post("/session", {
            title: session.title,
            parentId: session.parentId,
          })

          // Mark as synced locally
          await db
            .update(sessions)
            .set({
              isSynced: true,
              lastSyncTimestamp: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, session.id))
        } catch (error) {
          // Continue with other sessions if one fails
        }
      }

      // Refresh all session queries
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.remote.sessions.all })
    } catch (error) {
      throw error
    }
  }

  // Sync remote sessions to local
  async syncSessionsFromRemote() {
    try {
      const activeProject = await this.getActiveProject()

      // Ensure API client is using the active project's server URL
      await apiClient.updateBaseUrl(activeProject.serverHostname, activeProject.serverPort)

      // Fetch remote sessions directly
      const response = await apiClient.axios.get("/session")
      const remoteSessions = response.data

      // Import database utilities
      const db = (await import("../../db")).default
      const { sessions } = await import("../../db/schema")

      // Store sessions locally with active project ID
      for (const remoteSession of remoteSessions || []) {
        try {
          await db
            .insert(sessions)
            .values({
              id: remoteSession.id,
              projectId: activeProject.id,
              parentId: remoteSession.parentId || null,
              title: remoteSession.title,
              version: remoteSession.version,
              shareUrl: remoteSession.share?.url || null,
              timeCreated: new Date(remoteSession.time.created),
              timeUpdated: new Date(remoteSession.time.updated),
              revertMessageId: remoteSession.revert?.messageID || null,
              revertPartId: remoteSession.revert?.partID || null,
              revertSnapshot: remoteSession.revert?.snapshot || null,
              revertDiff: remoteSession.revert?.diff || null,
              // Initialize with 0 - will be calculated from messages
              totalCost: 0,
              totalTokensInput: 0,
              totalTokensOutput: 0,
              totalTokensReasoning: 0,
              totalTokensCacheRead: 0,
              totalTokensCacheWrite: 0,
              messageCount: 0,
              isSynced: true,
              lastSyncTimestamp: new Date(),
              isFavorite: false,
              localNotes: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: sessions.id,
              set: {
                title: remoteSession.title,
                version: remoteSession.version,
                shareUrl: remoteSession.share?.url || null,
                timeCreated: new Date(remoteSession.time.created),
                timeUpdated: new Date(remoteSession.time.updated),
                revertMessageId: remoteSession.revert?.messageID || null,
                revertPartId: remoteSession.revert?.partID || null,
                revertSnapshot: remoteSession.revert?.snapshot || null,
                revertDiff: remoteSession.revert?.diff || null,
                isSynced: true,
                lastSyncTimestamp: new Date(),
                updatedAt: new Date(),
              },
            })
        } catch (error) {
          // Continue with other sessions if one fails
        }
      }

      this.queryClient?.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
    } catch (error) {
      throw error
    }
  }

  // Full bidirectional sync
  async fullSync() {
    await Promise.all([this.syncSessionsToRemote(), this.syncSessionsFromRemote()])
  }
}

export const syncService = SyncService.getInstance()

// React hooks for sync operations
export function useSyncToRemoteMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      syncService.setQueryClient(queryClient)
      return syncService.syncSessionsToRemote()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.all })
    },
  })
}

export function useSyncFromRemoteMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      syncService.setQueryClient(queryClient)
      return syncService.syncSessionsFromRemote()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.all })
    },
  })
}

export function useFullSyncMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      syncService.setQueryClient(queryClient)
      return syncService.fullSync()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sync.all })
    },
  })
}

export function useOptimisticSessionMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionData: any) => {
      syncService.setQueryClient(queryClient)
      return syncService.createSessionOptimistic(sessionData)
    },
  })
}
