import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "./keys"
import { localConfigService } from "./local/config"
import { apiClient } from "./remote/client"

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

  // Optimistic session creation - create locally first, then sync to remote
  async createSessionOptimistic(sessionData: any) {
    // Create locally first for immediate UI feedback
    const localSession = {
      ...sessionData,
      id: `temp_${Date.now()}`, // Temporary ID
      isSynced: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Update local cache optimistically
    this.queryClient?.setQueryData(queryKeys.local.sessions.lists(), (old: any[]) => [localSession, ...(old || [])])

    try {
      // Sync to remote
      await apiClient.axios.post("/session", sessionData)

      // Mark sync timestamp
      await localConfigService.setAppConfig({
        lastSyncTimestamp: new Date(),
      })

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
      // Import the session repository to get unsynced sessions
      const { eq } = await import("drizzle-orm")
      const db = (await import("../../db")).default
      const { sessions } = await import("../../db/schema")

      // Get unsynced local sessions directly from database
      const unsyncedSessions = await db.select().from(sessions).where(eq(sessions.isSynced, false))

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
          console.error(`Failed to sync session ${session.id}:`, error)
        }
      }

      // Refresh all session queries
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
      this.queryClient?.invalidateQueries({ queryKey: queryKeys.remote.sessions.all })
    } catch (error) {
      console.error("Failed to sync sessions:", error)
      throw error
    }
  }

  // Sync remote sessions to local
  async syncSessionsFromRemote() {
    try {
      // Fetch remote sessions directly
      const response = await apiClient.axios.get("/session")
      const remoteSessions = response.data

      // Import database utilities
      const db = (await import("../../db")).default
      const { sessions } = await import("../../db/schema")

      // Store sessions locally
      for (const remoteSession of remoteSessions || []) {
        try {
          await db
            .insert(sessions)
            .values({
              id: remoteSession.id,
              parentId: remoteSession.parentId,
              title: remoteSession.title,
              version: remoteSession.version,
              shareUrl: remoteSession.shareUrl,
              timeCreated: new Date(remoteSession.time.created),
              timeUpdated: new Date(remoteSession.time.updated),
              revertMessageId: remoteSession.revertMessageId,
              revertPartId: remoteSession.revertPartId,
              revertSnapshot: remoteSession.revertSnapshot,
              revertDiff: remoteSession.revertDiff,
              isSynced: true,
              lastSyncTimestamp: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: sessions.id,
              set: {
                title: remoteSession.title,
                version: remoteSession.version,
                shareUrl: remoteSession.shareUrl,
                timeCreated: new Date(remoteSession.time.created),
                timeUpdated: new Date(remoteSession.time.updated),
                revertMessageId: remoteSession.revertMessageId,
                revertPartId: remoteSession.revertPartId,
                revertSnapshot: remoteSession.revertSnapshot,
                revertDiff: remoteSession.revertDiff,
                isSynced: true,
                lastSyncTimestamp: new Date(),
                updatedAt: new Date(),
              },
            })
        } catch (error) {
          console.error(`Failed to sync session ${remoteSession.id} from remote:`, error)
        }
      }

      this.queryClient?.invalidateQueries({ queryKey: queryKeys.local.sessions.all })
    } catch (error) {
      console.error("Failed to sync sessions from remote:", error)
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
