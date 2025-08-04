import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRemoteSessionsQuery } from "@/services/api/remote/sessions"
import { useUpsertLocalSessionMutation } from "@/services/api/local/sessions"
import { useLocalAppConfigQuery } from "@/services/api/local/config"
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

  const queryClient = useQueryClient()
  const { data: appConfig } = useLocalAppConfigQuery()
  const { data: remoteSessions, error: remoteError } = useRemoteSessionsQuery()
  const upsertLocalSession = useUpsertLocalSessionMutation()

  const isConnected = appConfig?.connectionStatus === "connected"

  const syncSessions = async () => {
    if (!isConnected || !remoteSessions) return

    setIsLoading(true)
    try {
      for (const remoteSession of remoteSessions) {
        const localSession: Omit<Session, "createdAt" | "updatedAt"> = {
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
        }

        await upsertLocalSession.mutateAsync({
          session: localSession,
          preserveRemoteTimestamp: true,
        })
      }

      // Invalidate local queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.lists() })
      setLastSyncTime(new Date())
    } catch (error) {
      // Session sync failed
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-sync when connected and remote sessions are available
  useEffect(() => {
    if (isConnected && remoteSessions && !remoteError && !isLoading) {
      syncSessions()
    }
  }, [isConnected, remoteSessions, remoteError])

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
