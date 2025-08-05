import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useUpsertLocalSessionMutation } from "@/services/api/local/sessions"
import { useActiveProjectQuery } from "@/services/api/local/projects"
import { queryKeys } from "@/services/api/keys"
import type { Session } from "@/db/types"

interface DataSyncContextValue {
  isLoading: boolean
  lastSyncTime: Date | null
  syncSessions: () => Promise<void>
  syncMessages: (sessionId: string) => Promise<void>
}

const DataSyncContext = createContext<DataSyncContextValue | null>(null)

interface DataSyncProviderProps {
  children: ReactNode
}

export const DataSyncProvider = ({ children }: DataSyncProviderProps) => {
  const [isLoading, setIsLoading] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
  const [hasInitialSync, setHasInitialSync] = useState(false)

  const queryClient = useQueryClient()
  const { data: activeProject } = useActiveProjectQuery()
  const { data: remoteSessions, error: remoteError } = useRemoteSessionsQuery()
  const upsertLocalSession = useUpsertLocalSessionMutation()

  const isConnected = activeProject?.connectionStatus === "connected"

  const transformRemoteSession = (remoteSession: any, projectId: string): Omit<Session, "createdAt" | "updatedAt"> => ({
    id: remoteSession.id,
    projectId,
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
  })

  const syncSessions = async () => {
    if (!isConnected || !remoteSessions || !activeProject) return

    setIsLoading(true)
    try {
      // Process all sessions in parallel instead of sequentially
      const upsertPromises = remoteSessions.map(async (remoteSession) => {
        try {
          const localSession = transformRemoteSession(remoteSession, activeProject.id)
          return await upsertLocalSession.mutateAsync({
            session: localSession,
            preserveRemoteTimestamp: true,
          })
        } catch (error) {
          // Log individual session sync failure but don't break the batch
          console.warn(`Failed to sync session ${remoteSession.id}:`, error)
          return null
        }
      })

      const results = await Promise.all(upsertPromises)
      const successCount = results.filter(Boolean).length

      // Only invalidate if we actually synced sessions
      if (successCount > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
        setLastSyncTime(new Date())
      }
    } catch (error) {
      console.error("Session sync failed:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Only sync once when first connecting
  useEffect(() => {
    if (isConnected && !hasInitialSync && remoteSessions && !remoteError) {
      syncSessions().then(() => setHasInitialSync(true))
    }
  }, [isConnected, hasInitialSync, remoteSessions, remoteError])

  // Reset initial sync flag when disconnected
  useEffect(() => {
    if (!isConnected) {
      setHasInitialSync(false)
    }
  }, [isConnected])

  const syncMessages = async (_sessionId: string) => {
    if (!isConnected) return
    // Message sync placeholder
  }

  const value: DataSyncContextValue = {
    isLoading,
    lastSyncTime,
    syncSessions,
    syncMessages,
  }

  return <DataSyncContext.Provider value={value}>{children}</DataSyncContext.Provider>
}

export const useDataSync = () => {
  const context = useContext(DataSyncContext)
  if (!context) {
    throw new Error("useDataSync must be used within a DataSyncProvider")
  }
  return context
}
