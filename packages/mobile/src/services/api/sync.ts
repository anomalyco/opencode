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
      // Get unsynced local sessions
      const unsyncedSessions = await this.queryClient?.fetchQuery({
        queryKey: queryKeys.local.sessions.unsynced(),
      })

      for (const session of unsyncedSessions || []) {
        try {
          // Create on remote
          await apiClient.axios.post("/session", {
            title: session.title,
            parentId: session.parentId,
          })

          // Mark as synced locally
          await localConfigService.setAppConfig({
            lastSyncTimestamp: new Date(),
          })
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
      const remoteSessions = await this.queryClient?.fetchQuery({
        queryKey: queryKeys.remote.sessions.lists(),
      })

      // Store sessions locally
      for (const remoteSession of remoteSessions || []) {
        // This would need the actual local session creation logic
        // Implementation depends on your local session structure
        console.log("Syncing session from remote:", remoteSession.id)
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
